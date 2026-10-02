-- Twitter-style benchmark schema
-- Row targets: 50,000 users, 500,000 posts, ~2,000,000 likes (~150 MB)

CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    username      VARCHAR(64)  NOT NULL UNIQUE,
    display_name  VARCHAR(128) NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users(id),
    content    TEXT        NOT NULL,
    posted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Feed query: ORDER BY posted_at DESC, id DESC LIMIT 20
CREATE INDEX IF NOT EXISTS idx_posts_feed
    ON posts (posted_at DESC, id DESC);

-- Post lookup by id uses the PK; likes lookups use the index below.
CREATE TABLE IF NOT EXISTS likes (
    user_id    BIGINT      NOT NULL REFERENCES users(id),
    post_id    BIGINT      NOT NULL REFERENCES posts(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_likes_post_id ON likes (post_id);

-- Useful for ANALYZE after seeding
ANALYZE;