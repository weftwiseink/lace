// IMPLEMENTATION_VALIDATION
import { describe, it, expect } from "vitest";
import { parseDockerfileUser } from "@/lib/dockerfile";

// --- parseDockerfileUser ---

describe("parseDockerfileUser", () => {
  it("extracts USER from single-stage Dockerfile", () => {
    const content = `FROM node:24-bookworm
RUN apt-get update
USER node
RUN echo "hello"
`;
    expect(parseDockerfileUser(content)).toBe("node");
  });

  it("extracts last USER from final stage of multi-stage Dockerfile", () => {
    const content = `FROM node:24 AS builder
USER builduser
RUN npm install

FROM debian:bookworm
RUN apt-get update
USER vscode
`;
    expect(parseDockerfileUser(content)).toBe("vscode");
  });

  it("returns null when no USER directive exists", () => {
    const content = `FROM node:24-bookworm
RUN apt-get update
RUN echo "no user set"
`;
    expect(parseDockerfileUser(content)).toBeNull();
  });

  it("returns null when intermediate stage has USER but final stage does not", () => {
    const content = `FROM node:24 AS builder
USER node
RUN npm install

FROM debian:bookworm
RUN apt-get update
`;
    expect(parseDockerfileUser(content)).toBeNull();
  });

  it("returns null for empty content", () => {
    expect(parseDockerfileUser("")).toBeNull();
  });

  it("returns null when USER contains ARG reference", () => {
    const content = `FROM node:24-bookworm
ARG USERNAME=node
USER $USERNAME
`;
    expect(parseDockerfileUser(content)).toBeNull();
  });

  it("returns null when USER contains ENV reference with braces", () => {
    const content = `FROM node:24-bookworm
USER \${MY_USER}
`;
    expect(parseDockerfileUser(content)).toBeNull();
  });

  it("extracts user from USER user:group format", () => {
    const content = `FROM node:24-bookworm
USER node:node
`;
    expect(parseDockerfileUser(content)).toBe("node");
  });

  it("returns the last USER in the final stage when multiple exist", () => {
    const content = `FROM node:24-bookworm
USER root
RUN apt-get update
USER node
`;
    expect(parseDockerfileUser(content)).toBe("node");
  });
});
