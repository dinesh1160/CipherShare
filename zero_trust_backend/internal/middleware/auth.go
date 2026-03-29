package middleware

import (
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// AuthMiddleware is a temporary stub for development.
// It injects a fixed authenticated user id into request context.
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := 1
		headerValue := strings.TrimSpace(c.GetHeader("X-User-ID"))
		if headerValue != "" {
			if parsed, err := strconv.Atoi(headerValue); err == nil && parsed > 0 {
				userID = parsed
			}
		}

		c.Set("user_id", userID)
		c.Next()
	}
}
