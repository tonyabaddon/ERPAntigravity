# Multistage build for Go application
FROM golang:1.21-alpine AS builder

# Set the Current Working Directory inside the container
WORKDIR /app

# Copy go.mod and go.sum files (if they exist)
COPY go.mod* go.sum* ./

# Download all dependencies (will be cached if mod files don't change)
RUN go mod download || true

# Copy the source code into the container
COPY . .

# Build the Go app
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

######## Start a new stage from scratch #######
FROM alpine:latest  

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /root/

# Copy the Pre-built binary file from the previous stage
COPY --from=builder /app/main .

# Expose port (default 8080)
EXPOSE 8080

# Command to run the executable
CMD ["./main"]
