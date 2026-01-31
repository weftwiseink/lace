ARG BASE=node
ARG TAG=24-bookworm
FROM ${BASE}:${TAG}
RUN echo "multi-arg substitution"
