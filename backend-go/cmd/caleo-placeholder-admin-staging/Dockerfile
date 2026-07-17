FROM golang:1.25-alpine AS build
WORKDIR /app
COPY main.go .
RUN go mod init caleo-placeholder-admin-staging && go build -o server main.go

FROM alpine:3
COPY --from=build /app/server /server
EXPOSE 8080
CMD ["/server"]
