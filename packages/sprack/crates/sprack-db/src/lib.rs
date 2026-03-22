/// sprack-db: shared SQLite library for the sprack ecosystem.
pub fn hello() -> &'static str {
    "sprack-db"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hello() {
        assert_eq!(hello(), "sprack-db");
    }
}
