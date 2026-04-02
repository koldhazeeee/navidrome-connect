-- +goose Up
ALTER TABLE user
    ADD COLUMN api_key varchar(255) default '' not null;

ALTER TABLE user
    ADD COLUMN api_key_hash varchar(64) default '' not null;

CREATE INDEX user_api_key_hash
    ON user(api_key_hash);

-- +goose Down
DROP INDEX IF EXISTS user_api_key_hash;

ALTER TABLE user
    DROP COLUMN api_key_hash;

ALTER TABLE user
    DROP COLUMN api_key;
