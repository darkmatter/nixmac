use mockall::mock;

mock! {
    pub Sentry {}

    impl Sentry {
        fn capture_message(&self, msg: &str, level: sentry::Level);
    }
}
