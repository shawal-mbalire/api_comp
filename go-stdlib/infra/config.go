// Package infra holds config plumbing — the only place env vars are read.
package infra

import (
	"os"
	"strconv"
)

// Config is frozen, typed app configuration.
type Config struct {
	Port          string
	ConnectionURI string
	PoolSize      int32
}

// Load reads the environment. Defaults match the contract/Docker compose.
func Load() Config {
	return Config{
		Port:          envOr("PORT", "8081"),
		ConnectionURI: envOr("DATABASE_URL", "postgres://app:app@db:5432/app"),
		PoolSize:      envInt32("POOL_SIZE", 10),
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt32(key string, fallback int32) int32 {
	v, err := strconv.ParseInt(os.Getenv(key), 10, 32)
	if err != nil {
		return fallback
	}
	if v <= 0 {
		return fallback
	}
	return int32(v)
}