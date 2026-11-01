package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// ApplyTaskQuotaSettlement commits wallet/subscription, token, counters and the
// task marker together. A stale poll cannot apply its delta a second time.
// External log databases are delivered separately from the durable task row.
func ApplyTaskQuotaSettlement(task *Task, actualQuota int, log *Log) error {
	if actualQuota < 0 || task.ID <= 0 {
		return fmt.Errorf("invalid task settlement")
	}
	var stored Task
	var token Token
	appliedDelta := 0
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).First(&stored, task.ID).Error; err != nil {
			return err
		}
		if stored.Quota != task.Quota || stored.PrivateData.PendingBillingLog != nil {
			return nil
		}
		delta := actualQuota - stored.Quota
		if delta != 0 {
			var user User
			if err := lockForUpdate(tx).First(&user, stored.UserId).Error; err != nil {
				return err
			}
			if stored.PrivateData.BillingSource == "subscription" && stored.PrivateData.SubscriptionId > 0 {
				var subscription UserSubscription
				if err := lockForUpdate(tx).First(&subscription, stored.PrivateData.SubscriptionId).Error; err != nil {
					return err
				}
				used := max(subscription.AmountUsed+int64(delta), 0)
				if subscription.AmountTotal > 0 && used > subscription.AmountTotal {
					return fmt.Errorf("subscription used exceeds total")
				}
				if err := tx.Model(&subscription).Update("amount_used", used).Error; err != nil {
					return err
				}
			} else if stored.PrivateData.BillingSource != "platform_mirror" {
				if delta < 0 && user.Quota > common.MaxWalletQuota+delta {
					return ErrWalletQuotaLimitExceeded
				}
				if err := tx.Model(&user).Update("quota", gorm.Expr("quota - ?", delta)).Error; err != nil {
					return err
				}
			}
			if stored.PrivateData.TokenId > 0 {
				err := lockForUpdate(tx).Where("id = ? AND user_id = ?", stored.PrivateData.TokenId, stored.UserId).First(&token).Error
				if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
				// Deleted credentials cannot be restored; the user's refund remains valid.
				if token.Id > 0 {
					if err := tx.Model(&token).Updates(map[string]any{
						"remain_quota":  gorm.Expr("remain_quota - ?", delta),
						"used_quota":    gorm.Expr("used_quota + ?", delta),
						"accessed_time": common.GetTimestamp(),
					}).Error; err != nil {
						return err
					}
				}
			}
			if err := tx.Model(&user).Update("used_quota", gorm.Expr("used_quota + ?", delta)).Error; err != nil {
				return err
			}
			if err := tx.Model(&Channel{}).Where("id = ?", stored.ChannelId).Update("used_quota", gorm.Expr("used_quota + ?", delta)).Error; err != nil {
				return err
			}
			if log != nil && !(log.Type == LogTypeConsume && !common.LogConsumeEnabled) {
				ensureLogRequestId(log)
				if DB == LOG_DB {
					if err := tx.Create(log).Error; err != nil {
						return err
					}
				} else {
					stored.PrivateData.PendingBillingLog = log
				}
			}
		}
		stored.Quota = actualQuota
		stored.PrivateData.BillingContext = task.PrivateData.BillingContext
		stored.PrivateData.PendingBillingResult = nil
		stored.BillingPending = stored.PrivateData.PendingBillingLog != nil
		if err := tx.Model(&stored).Select("quota", "private_data", "billing_pending").Updates(&stored).Error; err != nil {
			return err
		}
		appliedDelta = delta
		return nil
	})
	if err != nil {
		return err
	}
	*task = stored
	if appliedDelta != 0 {
		// Cached balances can include reservations still waiting in the batch
		// queue. Apply only our committed delta; rehydrating from DB loses them.
		if common.RedisEnabled {
			if stored.PrivateData.BillingSource != "subscription" && stored.PrivateData.BillingSource != "platform_mirror" {
				if _, err := cacheApplyUserQuotaDelta(stored.UserId, -int64(appliedDelta)); err != nil {
					common.SysError("update settled user quota cache: " + err.Error())
				}
			}
			if token.Id > 0 {
				if _, err := cacheApplyTokenQuotaDelta(token.Id, token.Key, -int64(appliedDelta)); err != nil {
					common.SysError("update settled token quota cache: " + err.Error())
				}
			}
		}
		if log != nil && log.Type == LogTypeConsume && common.LogConsumeEnabled && common.DataExportEnabled {
			node := stored.PrivateData.NodeName
			if node == "" {
				node = common.NodeName
			}
			LogQuotaData(QuotaDataLogParams{UserID: log.UserId, Username: log.Username, ModelName: log.ModelName, Quota: log.Quota, CreatedAt: log.CreatedAt, UseGroup: log.Group, TokenID: log.TokenId, ChannelID: log.ChannelId, NodeName: node})
		}
	}
	return FlushTaskBillingLog(task)
}

// FlushTaskBillingLog serializes delivery with the primary task row. A stable
// request ID recognizes a successful external insert after an interrupted ack.
// This is a recoverable delivery, not a cross-database transaction.
func FlushTaskBillingLog(task *Task) error {
	if task.PrivateData.PendingBillingLog == nil {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		// SQLite has no FOR UPDATE. Acquire its write lock before external I/O,
		// so two deferred transactions cannot both publish the same receipt.
		if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
			if err := tx.Model(&Task{}).Where("id = ? AND billing_pending = ?", task.ID, true).
				UpdateColumn("billing_pending", true).Error; err != nil {
				return err
			}
		}
		var stored Task
		if err := lockForUpdate(tx).First(&stored, task.ID).Error; err != nil {
			return err
		}
		log := stored.PrivateData.PendingBillingLog
		if log == nil {
			*task = stored
			return nil
		}
		var count int64
		if err := LOG_DB.Model(&Log{}).Where("request_id = ?", log.RequestId).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			if err := LOG_DB.Create(log).Error; err != nil {
				return err
			}
		}
		stored.PrivateData.PendingBillingLog = nil
		stored.BillingPending = false
		if err := tx.Model(&stored).Select("private_data", "billing_pending").Updates(&stored).Error; err != nil {
			return err
		}
		*task = stored
		return nil
	})
}
