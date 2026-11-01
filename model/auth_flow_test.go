package model

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestAuthFlowIsBoundAndConsumedOnce(t *testing.T) {
	truncateTables(t)

	token, created, err := CreateAuthFlow(AuthFlowCreate{
		Purpose:   AuthFlowPurposeOAuth,
		Provider:  "github",
		Intent:    AuthFlowIntentBind,
		UserId:    42,
		SessionId: "session-a",
		Payload:   `{"affiliate_code":"invite"}`,
		ExpiresAt: time.Now().Add(time.Minute),
	})
	require.NoError(t, err)
	require.NotEmpty(t, token)
	assert.NotEqual(t, token, created.TokenHash)

	_, err = ConsumeAuthFlow(token, AuthFlowMatch{
		Purpose:   AuthFlowPurposeOAuth,
		Provider:  "github",
		Intent:    AuthFlowIntentBind,
		UserId:    99,
		SessionId: "session-a",
	})
	assert.ErrorIs(t, err, ErrAuthFlowInvalid)

	peeked, err := GetAuthFlow(token, AuthFlowMatch{Purpose: AuthFlowPurposeOAuth, Provider: "github"})
	require.NoError(t, err)
	assert.Nil(t, peeked.ConsumedAt)

	consumed, err := ConsumeAuthFlow(token, AuthFlowMatch{
		Purpose:   AuthFlowPurposeOAuth,
		Provider:  "github",
		Intent:    AuthFlowIntentBind,
		UserId:    42,
		SessionId: "session-a",
	})
	require.NoError(t, err)
	require.NotNil(t, consumed.ConsumedAt)

	_, err = ConsumeAuthFlow(token, AuthFlowMatch{Purpose: AuthFlowPurposeOAuth})
	assert.ErrorIs(t, err, ErrAuthFlowConsumed)
}

func TestAuthFlowExpiryIsEnforced(t *testing.T) {
	truncateTables(t)

	token, flow, err := CreateAuthFlow(AuthFlowCreate{
		Purpose:   AuthFlowPurposeTwoFALogin,
		UserId:    7,
		ExpiresAt: time.Now().Add(time.Minute),
	})
	require.NoError(t, err)
	require.NoError(t, DB.Model(&AuthFlow{}).Where("id = ?", flow.Id).Update("expires_at", time.Now().Add(-time.Second)).Error)

	_, err = GetAuthFlow(token, AuthFlowMatch{Purpose: AuthFlowPurposeTwoFALogin})
	assert.True(t, errors.Is(err, ErrAuthFlowExpired))
	_, err = ConsumeAuthFlow(token, AuthFlowMatch{Purpose: AuthFlowPurposeTwoFALogin})
	assert.True(t, errors.Is(err, ErrAuthFlowExpired))
}

func TestExternalAuthAssertionCanOnlyBeClaimedOnce(t *testing.T) {
	truncateTables(t)
	expiresAt := time.Now().Add(time.Minute)

	require.NoError(t, ClaimExternalAuthAssertion(AuthFlowPurposeTelegramAssertion, "signed-assertion", expiresAt))
	err := ClaimExternalAuthAssertion(AuthFlowPurposeTelegramAssertion, "signed-assertion", expiresAt)
	assert.ErrorIs(t, err, ErrAuthFlowConsumed)

	require.NoError(t, ClaimExternalAuthAssertion(AuthFlowPurposeTelegramAssertion, "different-assertion", expiresAt))
}

func TestConsumeAuthFlowWithActionRollsBackTogether(t *testing.T) {
	truncateTables(t)
	token, _, err := CreateAuthFlow(AuthFlowCreate{
		Purpose:   AuthFlowPurposeTelegramBind,
		UserId:    42,
		SessionId: "session-a",
		ExpiresAt: time.Now().Add(time.Minute),
	})
	require.NoError(t, err)
	actionErr := errors.New("binding failed")

	_, err = ConsumeAuthFlowWithAction(token, AuthFlowMatch{
		Purpose: AuthFlowPurposeTelegramBind, UserId: 42, SessionId: "session-a",
	}, func(tx *gorm.DB, _ *AuthFlow) error {
		if err := ClaimExternalAuthAssertionWithTx(tx, AuthFlowPurposeTelegramAssertion, "assertion-a", time.Now().Add(time.Minute)); err != nil {
			return err
		}
		return actionErr
	})
	assert.ErrorIs(t, err, actionErr)

	flow, err := GetAuthFlow(token, AuthFlowMatch{Purpose: AuthFlowPurposeTelegramBind})
	require.NoError(t, err)
	assert.Nil(t, flow.ConsumedAt)
	require.NoError(t, ClaimExternalAuthAssertion(AuthFlowPurposeTelegramAssertion, "assertion-a", time.Now().Add(time.Minute)))
}

func TestAuthFlowInstantsAcrossDST(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := os.Getenv("TEST_FIXED_" + strings.ToUpper(dialect) + "_DSN")
			if dialect == "sqlite" {
				dsn = "local"
				previousPath := common.SQLitePath
				common.SQLitePath = filepath.Join(t.TempDir(), "auth-flow.db")
				t.Cleanup(func() { common.SQLitePath = previousPath })
			}
			if dsn == "" {
				t.Skip("isolated database DSN is not configured")
			}
			t.Setenv("TEST_AUTH_FLOW_DSN", dsn)
			db, dbType, err := chooseDB("TEST_AUTH_FLOW_DSN", false)
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			previousDB, previousType := DB, common.MainDatabaseType()
			DB = db
			common.SetMainDatabaseType(dbType)
			t.Cleanup(func() {
				DB = previousDB
				common.SetMainDatabaseType(previousType)
				require.NoError(t, sqlDB.Close())
			})
			require.NoError(t, db.AutoMigrate(&AuthFlow{}))
			location, err := time.LoadLocation("America/Los_Angeles")
			require.NoError(t, err)
			beforeRollback := time.Date(2026, 11, 1, 8, 55, 0, 0, time.UTC).In(location)
			afterRollback := beforeRollback.Add(10 * time.Minute)
			purpose := fmt.Sprintf("dst_%d", time.Now().UnixNano())
			t.Cleanup(func() { require.NoError(t, db.Where("purpose = ?", purpose).Delete(&AuthFlow{}).Error) })
			for _, item := range []struct {
				name        string
				now, expiry time.Time
				expired     bool
			}{
				{"future_across_rollback", beforeRollback, afterRollback, false},
				{"expired_across_rollback", afterRollback, beforeRollback, true},
				{"exact_expiry", beforeRollback, beforeRollback, true},
				{"existing_utc_expiry", beforeRollback, afterRollback.UTC(), false},
			} {
				t.Run(item.name, func(t *testing.T) {
					DB = db.Session(&gorm.Session{NowFunc: func() time.Time { return item.now }})
					t.Cleanup(func() { DB = db })
					token := purpose + item.name
					flow := AuthFlow{TokenHash: authFlowTokenHash(token), Purpose: purpose, ExpiresAt: item.expiry}
					require.NoError(t, DB.Create(&flow).Error)
					match := AuthFlowMatch{Purpose: purpose}
					_, readErr := GetAuthFlow(token, match)
					actions := 0
					_, consumeErr := ConsumeAuthFlowWithAction(token, match, func(*gorm.DB, *AuthFlow) error { actions++; return nil })
					if item.expired {
						require.ErrorIs(t, readErr, ErrAuthFlowExpired)
						require.ErrorIs(t, consumeErr, ErrAuthFlowExpired)
						require.Zero(t, actions)
						require.NoError(t, db.First(&flow, flow.Id).Error)
						require.Nil(t, flow.ConsumedAt)
					} else {
						require.NoError(t, readErr)
						require.NoError(t, consumeErr)
						require.Equal(t, 1, actions)
						_, err := ConsumeAuthFlow(token, match)
						require.ErrorIs(t, err, ErrAuthFlowConsumed)
					}
				})
			}
			for _, consumed := range []bool{false, true} {
				t.Run(fmt.Sprintf("cleanup_consumed_%t", consumed), func(t *testing.T) {
					old := AuthFlow{TokenHash: authFlowTokenHash(fmt.Sprintf("%s_%t_old", purpose, consumed)), Purpose: purpose, ExpiresAt: beforeRollback}
					recent := AuthFlow{TokenHash: authFlowTokenHash(fmt.Sprintf("%s_%t_recent", purpose, consumed)), Purpose: purpose, ExpiresAt: afterRollback}
					if consumed {
						old.ConsumedAt, recent.ConsumedAt = &beforeRollback, &afterRollback
						old.ExpiresAt, recent.ExpiresAt = afterRollback.Add(time.Hour), afterRollback.Add(time.Hour)
					}
					require.NoError(t, db.Create(&old).Error)
					require.NoError(t, db.Create(&recent).Error)
					require.NoError(t, DeleteExpiredAuthFlows(beforeRollback.Add(AuthFlowDefaultCleanupRetention)))
					var count int64
					require.NoError(t, db.Model(&AuthFlow{}).Where("id IN ?", []int64{old.Id, recent.Id}).Count(&count).Error)
					require.EqualValues(t, 2, count, "equal cutoff and later instants must remain")
					require.NoError(t, DeleteExpiredAuthFlows(afterRollback.Add(AuthFlowDefaultCleanupRetention)))
					require.ErrorIs(t, db.First(&AuthFlow{}, old.Id).Error, gorm.ErrRecordNotFound)
					require.NoError(t, db.First(&AuthFlow{}, recent.Id).Error, "equal cutoff must remain")
				})
			}
		})
	}
}
