//! Error types for sprack-db.

/// All errors that can occur in sprack-db operations.
#[derive(Debug, thiserror::Error)]
pub enum SprackDbError {
    /// SQLite operation failed.
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    /// Filesystem operation failed.
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// A process status string could not be parsed into a known variant.
    #[error("Invalid process status: {0}")]
    InvalidStatus(String),

    /// WAL journal mode could not be activated on the database.
    #[error("WAL mode activation failed, got: {0}")]
    WalActivationFailed(String),

    /// Database schema version is newer than this binary supports.
    #[error("Unsupported schema version {0}: rebuild all sprack binaries")]
    UnsupportedSchemaVersion(i32),
}
