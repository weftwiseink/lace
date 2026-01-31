FROM node:24 AS build
RUN echo "build step"
COPY . .

FROM debian:bookworm
COPY --from=build /app /app
CMD ["node", "app"]
