// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
package controller

import (
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
)

type platformImageModel struct {
	ID         string `json:"id"`
	Type       string `json:"type"`
	Available  bool   `json:"available"`
	Parameters []struct {
		Name     string `json:"name"`
		Required bool   `json:"required"`
		Options  []struct {
			Value     string `json:"value"`
			IsDefault bool   `json:"is_default"`
		} `json:"options"`
	} `json:"parameters"`
}

// Translate only parameters published by this tenant's current catalog. The
// quote and native service still validate the selected provider and price.
func platformImageParameters(input map[string]any, model platformImageModel) (map[string]any, string, error) {
	if model.Type != "image" || !model.Available {
		return nil, "", fmt.Errorf("This model is not an available image model")
	}
	if prompt, ok := input["prompt"].(string); !ok || strings.TrimSpace(prompt) == "" || len(prompt) > 50000 {
		return nil, "", fmt.Errorf("Provide a non-empty prompt of at most 50000 bytes")
	}
	if count, exists := input["n"]; exists && count != nil {
		if number, ok := count.(float64); !ok || number != 1 {
			return nil, "", fmt.Errorf("This image endpoint supports n=1; create separate requests for more images")
		}
	}
	format := "b64_json"
	if value, exists := input["response_format"]; exists && value != nil {
		if value != "url" && value != "b64_json" {
			return nil, "", fmt.Errorf("response_format must be url or b64_json")
		}
		format = value.(string)
	}
	params := make(map[string]any)
	definitions := make(map[string][]string)
	for _, parameter := range model.Parameters {
		definitions[parameter.Name] = nil
		for _, option := range parameter.Options {
			definitions[parameter.Name] = append(definitions[parameter.Name], option.Value)
			if option.IsDefault {
				params[parameter.Name] = option.Value
			}
		}
	}
	for name, value := range input {
		if value == nil {
			continue
		}
		switch name {
		case "model", "prompt", "n", "response_format", "size", "quality", "user", "routing_preference":
		case "stream":
			if value != false {
				return nil, "", fmt.Errorf("Streaming images are not supported by this endpoint")
			}
		default:
			if _, published := definitions[name]; !published {
				return nil, "", fmt.Errorf("Unsupported image parameter: %s", name)
			}
			params[name] = value
		}
	}
	if value := input["quality"]; value != nil {
		quality, ok := value.(string)
		if !ok {
			return nil, "", fmt.Errorf("quality must be a string")
		}
		if quality == "standard" {
			quality = "auto"
		}
		if _, published := definitions["quality"]; published {
			params["quality"] = quality
		} else if quality != "auto" {
			return nil, "", fmt.Errorf("This model does not support quality; use its published resolution parameters")
		}
	}
	if value := input["size"]; value != nil {
		size, ok := value.(string)
		if !ok {
			return nil, "", fmt.Errorf("size must be a string")
		}
		options, directSize := definitions["size"]
		if directSize && (len(options) == 0 || slices.Contains(options, size) || slices.Contains(options, "1024x1024")) {
			params["size"] = size
		} else if size != "auto" {
			widthText, heightText, ok := strings.Cut(size, "x")
			width, widthErr := strconv.Atoi(widthText)
			height, heightErr := strconv.Atoi(heightText)
			if !ok || widthErr != nil || heightErr != nil || width < 256 || height < 256 || width > 4096 || height > 4096 {
				return nil, "", fmt.Errorf("size must be auto or WIDTHxHEIGHT between 256 and 4096")
			}
			divisor, remainder := width, height
			for remainder != 0 {
				divisor, remainder = remainder, divisor%remainder
			}
			ratio := fmt.Sprintf("%d:%d", width/divisor, height/divisor)
			aspectName := "aspect_ratio"
			if _, published := definitions["aspectRatio"]; published {
				aspectName = "aspectRatio"
			}
			if values, published := definitions[aspectName]; !published || len(values) > 0 && !slices.Contains(values, ratio) {
				return nil, "", fmt.Errorf("The requested aspect ratio is not supported by this model")
			}
			params[aspectName] = ratio
			resolutionName := "resolution"
			if directSize {
				resolutionName = "size"
			} else if _, published := definitions["imageSize"]; published {
				resolutionName = "imageSize"
			}
			if values, published := definitions[resolutionName]; published {
				resolution := fmt.Sprintf("%dK", int(math.Ceil(float64(max(width, height))/1024)))
				if resolution == "3K" && !slices.Contains(values, resolution) {
					resolution = "4K"
				}
				if resolution == "1K" && !slices.Contains(values, resolution) && slices.Contains(values, "2K") {
					resolution = "2K"
				}
				if !slices.Contains(values, resolution) {
					return nil, "", fmt.Errorf("The requested resolution is not supported by this model")
				}
				params[resolutionName] = resolution
			}
		}
	}
	for _, parameter := range model.Parameters {
		if parameter.Required && params[parameter.Name] == nil {
			return nil, "", fmt.Errorf("Provide the published model parameter: %s", parameter.Name)
		}
	}
	return params, format, nil
}
