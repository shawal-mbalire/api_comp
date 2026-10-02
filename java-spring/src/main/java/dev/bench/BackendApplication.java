package dev.bench;

import dev.bench.domain.ports.FeedRepository;
import dev.bench.domain.workflows.FeedService;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

/**
 * Composition root (entry point): wires adapters into the domain workflow, then
 * starts the Spring context. No business logic lives here.
 *
 * Wiring: the Postgres driven adapter ({@code adapters.postgres.PostgresFeedRepository},
 * discovered as a {@code @Repository}) implements the {@link FeedRepository} port;
 * Spring injects it into the {@link FeedService} bean; the HTTP driving adapter
 * ({@code adapters.http.FeedController}) injects the service.
 */
@SpringBootApplication
public class BackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(BackendApplication.class, args);
    }

    /** Wire the domain workflow over the FeedRepository port. */
    @Bean
    public FeedService feedService(FeedRepository repo) {
        return new FeedService(repo);
    }
}