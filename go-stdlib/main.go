// Composition root — reads config, wires adapters into the domain workflows,
// starts the driving adapter. No business logic.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"backend-go/adapters"
	"backend-go/domain"
	"backend-go/infra"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()

	config := infra.Load()

	// Driven adapter: Postgres behind the FeedRepository port.
	repo, err := adapters.NewPostgresFeedRepository(ctx, config.ConnectionURI, config.PoolSize)
	if err != nil {
		log.Fatalf("postgres: %v", err)
	}
	defer repo.Close()

	// Domain workflows depend only on the port.
	service := domain.NewFeedService(repo)

	// Driving adapter: stdlib net/http (single process, exactly POOL_SIZE conns).
	srv := &http.Server{
		Addr:    ":" + config.Port,
		Handler: adapters.NewHandler(service),
	}

	go func() {
		log.Printf("go-stdlib on :%s (pool %d)", config.Port, config.PoolSize)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http: %v", err)
		}
	}()

	// LifetimePort: graceful shutdown on SIGTERM/SIGINT.
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}