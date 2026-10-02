package dev.bench.infra.config;

import javax.sql.DataSource;
import java.net.URI;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/**
 * Infra: config assembly — the ONLY place experiment env vars are turned into
 * runtime objects.
 *
 * Builds the single DataSource programmatically from:
 *   DATABASE_URL = postgres://user:pass@host:port/db   (NOT a jdbc URL)
 *   POOL_SIZE    = max connections per process (experiment hard limit: default/forced 10)
 *   PORT         = HTTP bind port (consumed via application.properties' ${PORT:8080})
 *
 * The pool maximum is set to exactly POOL_SIZE.
 */
@Configuration
public class DataSourceConfig {

    private static final String DEFAULT_DATABASE_URL = "postgres://app:app@db:5432/app";
    private static final int DEFAULT_POOL_SIZE = 10;

    private final Environment env;

    public DataSourceConfig(Environment env) {
        this.env = env;
    }

    @Bean(destroyMethod = "close")
    public DataSource dataSource() {
        String databaseUrl = env.getProperty("DATABASE_URL", DEFAULT_DATABASE_URL);
        int poolSize = Integer.parseInt(env.getProperty("POOL_SIZE", String.valueOf(DEFAULT_POOL_SIZE)));

        DbSpec spec = parse(databaseUrl);

        HikariDataSource ds = new HikariDataSource();
        ds.setPoolName("bench-pool");
        ds.setJdbcUrl(spec.jdbcUrl());
        ds.setUsername(spec.user());
        ds.setPassword(spec.password());
        ds.setMaximumPoolSize(poolSize); // hard requirement: exactly POOL_SIZE
        return ds;
    }

    private static DbSpec parse(String databaseUrl) {
        URI uri = URI.create(databaseUrl.trim());
        if (uri.getHost() == null) {
            throw new IllegalStateException("Cannot parse DATABASE_URL: " + databaseUrl);
        }
        String userInfo = uri.getUserInfo();
        String user = "";
        String password = "";
        if (userInfo != null && !userInfo.isEmpty()) {
            int colon = userInfo.indexOf(':');
            user = colon < 0 ? userInfo : userInfo.substring(0, colon);
            password = colon < 0 ? "" : userInfo.substring(colon + 1);
        }
        int port = uri.getPort();
        String path = uri.getPath() == null ? "" : uri.getPath();
        String database = path.startsWith("/") ? path.substring(1) : path;
        if (database.isEmpty()) {
            throw new IllegalStateException("DATABASE_URL is missing the database name: " + databaseUrl);
        }
        String jdbcUrl = "jdbc:postgresql://" + uri.getHost() + (port >= 0 ? ":" + port : "") + "/" + database;
        return new DbSpec(jdbcUrl, user, password);
    }

    private record DbSpec(String jdbcUrl, String user, String password) {
    }
}