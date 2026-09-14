package model

// SetUserQuotaMirror 直接把用户 quota 设为平台余额镜像（不是增减），并失效缓存。
// 仅供平台钱包权威模式使用：本地扣费只是展示近似值，平台每次登录/同步都会覆盖。
func SetUserQuotaMirror(id int, quota int) error {
	if quota < 0 {
		quota = 0
	}
	if err := DB.Model(&User{}).Where("id = ?", id).Update("quota", quota).Error; err != nil {
		return err
	}
	return invalidateUserCache(id)
}
