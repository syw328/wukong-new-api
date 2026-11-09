// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
package controller

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const (
	platformImageEditMaxReferences = 8
	platformImageEditMaxFileBytes  = 10 << 20
	platformImageEditMaxTotalBytes = 30 << 20
)

var imageEditFields = []string{"image", "image[]", "images", "images[]"}

type platformImageEditFile struct {
	part *multipart.FileHeader
	mime string
}

type platformImageEdit struct {
	urls    []string
	files   []platformImageEditFile
	digests []string
}

func readPlatformImageEditForm(c *gin.Context) (map[string]any, *multipart.Form, error) {
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return nil, nil, err
	}
	// Keep the original bytes available for the ordinary relay if this is
	// a model served by another channel.
	c.Request.Body = io.NopCloser(storage)
	reader, err := storage.NewReader()
	if err != nil {
		return nil, nil, err
	}
	defer reader.Close()
	request := c.Request.Clone(c.Request.Context())
	request.Body = reader
	multipartReader, err := request.MultipartReader()
	if err != nil {
		return nil, nil, err
	}
	form, err := multipartReader.ReadForm(1 << 20)
	if err != nil {
		return nil, nil, err
	}
	input := make(map[string]any, len(form.Value))
	for field, values := range form.Value {
		if len(values) == 1 {
			input[field] = values[0]
		} else {
			input[field] = values
		}
	}
	return input, form, nil
}

func preparePlatformImageEdit(input map[string]any, form *multipart.Form) (*platformImageEdit, error) {
	edit := &platformImageEdit{}
	if input["mask"] != nil || form != nil && len(form.File["mask"]) != 0 {
		return nil, fmt.Errorf("Mask editing is not supported by platform image models")
	}
	var files []*multipart.FileHeader
	for _, field := range imageEditFields {
		urls, err := platformImageEditURLs(input[field])
		if err != nil {
			return nil, err
		}
		edit.urls = append(edit.urls, urls...)
		delete(input, field)
		if form != nil {
			files = append(files, form.File[field]...)
		}
	}
	count := len(edit.urls) + len(files)
	if count < 1 || count > platformImageEditMaxReferences {
		return nil, fmt.Errorf("Provide 1 to %d reference images", platformImageEditMaxReferences)
	}
	if form != nil {
		if len(form.Value) > 24 {
			return nil, fmt.Errorf("Too many image edit fields")
		}
		for field := range form.File {
			switch field {
			case "image", "image[]", "images", "images[]":
			default:
				return nil, fmt.Errorf("Unsupported file field in image edit")
			}
		}
		for field, value := range input {
			if _, ok := value.([]string); ok {
				return nil, fmt.Errorf("Image edit parameters cannot be repeated")
			}
			switch field {
			case "n":
				number, err := strconv.ParseFloat(value.(string), 64)
				if err != nil {
					return nil, fmt.Errorf("n must be a number")
				}
				input[field] = number
			case "stream":
				flag, err := strconv.ParseBool(value.(string))
				if err != nil {
					return nil, fmt.Errorf("stream must be a boolean")
				}
				input[field] = flag
			}
		}
	}
	var total int64
	for _, file := range files {
		total += file.Size
		if file.Size <= 0 || file.Size > platformImageEditMaxFileBytes || total > platformImageEditMaxTotalBytes {
			return nil, fmt.Errorf("Reference images must be at most 10 MiB each and 30 MiB in total")
		}
		part, digest, err := inspectPlatformImageEditFile(file)
		if err != nil {
			return nil, err
		}
		edit.files = append(edit.files, part)
		edit.digests = append(edit.digests, digest)
	}
	// A non-nil reference list is needed even for a file-only request. The
	// staged URLs replace this field only after the catalog validates it.
	input["images"] = append([]string{}, edit.urls...)
	return edit, nil
}

func platformImageEditURLs(value any) ([]string, error) {
	var references []any
	switch typed := value.(type) {
	case nil:
		return nil, nil
	case []any:
		references = typed
	case []string:
		for _, item := range typed {
			references = append(references, item)
		}
	default:
		references = []any{typed}
	}
	urls := make([]string, 0, len(references))
	for _, item := range references {
		if object, ok := item.(map[string]any); ok {
			item = object["image_url"]
		}
		raw, ok := item.(string)
		parsed, err := url.Parse(raw)
		if !ok || len(raw) > 8192 || err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
			return nil, fmt.Errorf("Reference images must be uploaded files or HTTPS image URLs")
		}
		urls = append(urls, raw)
	}
	return urls, nil
}

func inspectPlatformImageEditFile(file *multipart.FileHeader) (platformImageEditFile, string, error) {
	part, err := file.Open()
	if err != nil {
		return platformImageEditFile{}, "", fmt.Errorf("Unable to read reference image")
	}
	defer part.Close()
	var header [512]byte
	n, err := io.ReadFull(part, header[:])
	if err != nil && err != io.ErrUnexpectedEOF {
		return platformImageEditFile{}, "", fmt.Errorf("Unable to read reference image")
	}
	contentType := http.DetectContentType(header[:n])
	switch contentType {
	case "image/png", "image/jpeg", "image/webp":
	default:
		return platformImageEditFile{}, "", fmt.Errorf("Reference images must be PNG, JPEG or WebP")
	}
	hash := sha256.New()
	hash.Write(header[:n])
	if _, err := io.Copy(hash, part); err != nil {
		return platformImageEditFile{}, "", fmt.Errorf("Unable to read reference image")
	}
	return platformImageEditFile{part: file, mime: contentType}, fmt.Sprintf("%x", hash.Sum(nil)), nil
}

type platformImageUploadError struct {
	status        int
	code, message string
}

func (edit *platformImageEdit) upload(c *gin.Context, parent *http.Request, idempotencyKey string) ([]string, *platformImageUploadError) {
	unavailable := &platformImageUploadError{502, "reference_upload_unavailable", "Unable to store the reference images"}
	origin, ok := common.PlatformPortalOrigin(parent)
	if !ok {
		return nil, unavailable
	}
	identity, err := service.PlatformRelayIdentityHeaders(c.GetInt("id"))
	if err != nil {
		return nil, &platformImageUploadError{403, "reference_upload_denied", "Sign in with your platform account to upload reference images"}
	}
	key, err := platformPortalServiceKey()
	if err != nil {
		return nil, unavailable
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, file := range edit.files {
		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition", `form-data; name="image"; filename="reference"`)
		header.Set("Content-Type", file.mime)
		out, err := writer.CreatePart(header)
		if err != nil {
			return nil, unavailable
		}
		in, err := file.part.Open()
		if err != nil {
			return nil, unavailable
		}
		_, err = io.Copy(out, in)
		in.Close()
		if err != nil {
			return nil, unavailable
		}
	}
	if err := writer.Close(); err != nil {
		return nil, unavailable
	}
	request, err := http.NewRequestWithContext(parent.Context(), http.MethodPost, origin+"/v1/media/image-references", &body)
	if err != nil {
		return nil, unavailable
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Authorization", "Bearer "+key)
	request.Header.Set("Idempotency-Key", idempotencyKey)
	for name, value := range identity {
		request.Header.Set(name, value)
	}
	response, err := platformPortalClient.Do(request)
	if err != nil {
		return nil, unavailable
	}
	defer response.Body.Close()
	var payload struct {
		Images []string `json:"images"`
		Error  struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if common.DecodeJson(io.LimitReader(response.Body, 64<<10), &payload) != nil {
		return nil, unavailable
	}
	if response.StatusCode >= 400 && response.StatusCode < 500 && strings.TrimSpace(payload.Error.Message) != "" {
		return nil, &platformImageUploadError{response.StatusCode, "reference_upload_rejected", payload.Error.Message}
	}
	if response.StatusCode != http.StatusCreated || len(payload.Images) != len(edit.files) {
		return nil, unavailable
	}
	return payload.Images, nil
}
