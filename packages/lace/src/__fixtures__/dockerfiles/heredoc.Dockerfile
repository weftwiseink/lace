# syntax=docker/dockerfile:1
FROM node:24
COPY <<EOF /etc/config
some config content
EOF
RUN echo "with heredoc"
