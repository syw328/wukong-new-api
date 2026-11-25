// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
// New file: the account's single API management key. It authenticates only the
// /v1/keys management endpoints; the table holds no usable secret.
package model

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const ManagementKeyPrefix = "sk-mgmt-"

// ManagementKey stores the SHA-256 of the full key and its last four characters
// for display. One row per account; deleting the row revokes the key.
type ManagementKey struct {
	Id         int    `json:"-"`
	UserId     int    `json:"-" gorm:"uniqueIndex"`
	KeyHash    string `json:"-" gorm:"type:varchar(64);uniqueIndex"`
	KeyTail    string `json:"-" gorm:"type:varchar(8)"`
	CreatedAt  int64  `json:"created_at" gorm:"bigint"`
	LastUsedAt int64  `json:"last_used_at" gorm:"bigint"`
}

var ErrManagementKeyInvalid = errors.New("invalid management key")

func (key *ManagementKey) MaskedKey() string {
	return ManagementKeyPrefix + "****" + key.KeyTail
}

func GetManagementKey(userID int) (*ManagementKey, error) {
	var key ManagementKey
	err := DB.Where("user_id = ?", userID).First(&key).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &key, nil
}

// RotateManagementKey issues a new key for the account, replacing any previous
// one at once. The full value is returned to the caller and never stored.
func RotateManagementKey(userID int) (string, *ManagementKey, error) {
	random, err := common.GenerateRandomCharsKey(48)
	if err != nil {
		return "", nil, err
	}
	full := ManagementKeyPrefix + random
	now := common.GetTimestamp()
	row := ManagementKey{UserId: userID, KeyHash: AccessTokenFingerprint(full), KeyTail: random[len(random)-4:], CreatedAt: now}
	err = DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&ManagementKey{}).Where("user_id = ?", userID).
			Updates(map[string]any{"key_hash": row.KeyHash, "key_tail": row.KeyTail, "created_at": now, "last_used_at": 0})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected > 0 {
			return nil
		}
		return tx.Create(&row).Error
	})
	if err != nil {
		return "", nil, err
	}
	return full, &row, nil
}

func DeleteManagementKey(userID int) (bool, error) {
	result := DB.Where("user_id = ?", userID).Delete(&ManagementKey{})
	return result.RowsAffected > 0, result.Error
}

// ValidateManagementKey resolves a presented sk-mgmt- key to its row.
func ValidateManagementKey(presented string) (*ManagementKey, error) {
	if !strings.HasPrefix(presented, ManagementKeyPrefix) || len(presented) > 128 {
		return nil, ErrManagementKeyInvalid
	}
	var key ManagementKey
	err := DB.Where("key_hash = ?", AccessTokenFingerprint(presented)).First(&key).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrManagementKeyInvalid
	}
	if err != nil {
		return nil, err
	}
	return &key, nil
}

// TouchManagementKey records use at most once a minute per key.
func TouchManagementKey(key *ManagementKey) {
	now := common.GetTimestamp()
	if key == nil || now-key.LastUsedAt < 60 {
		return
	}
	if err := DB.Model(&ManagementKey{}).Where("id = ?", key.Id).Update("last_used_at", now).Error; err != nil {
		common.SysLog("failed to record management key use: " + err.Error())
	}
}
