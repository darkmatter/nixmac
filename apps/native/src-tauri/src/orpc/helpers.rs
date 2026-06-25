use orpc::ORPCError;

pub fn internal_err(cmd: &str, error: impl std::fmt::Display) -> ORPCError {
    tracing::error!(command = cmd, error = %error, "orpc error");
    ORPCError::internal_server_error(error.to_string())
}
