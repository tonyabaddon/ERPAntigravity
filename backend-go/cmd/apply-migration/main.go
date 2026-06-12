package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	_ "github.com/lib/pq"
)

func main() {
	if len(os.Args) < 2 {
		log.Fatal("usage: apply-migration <path-to-sql>")
	}
	conn := os.Getenv("SUPABASE_DB_CONNECTION")
	if conn == "" {
		log.Fatal("SUPABASE_DB_CONNECTION env required")
	}
	sqlBytes, err := os.ReadFile(os.Args[1])
	if err != nil {
		log.Fatalf("read %s: %v", os.Args[1], err)
	}
	db, err := sql.Open("postgres", conn)
	if err != nil {
		log.Fatalf("open: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("ping: %v", err)
	}
	fmt.Println("[apply] connected, executing migration...")
	if _, err := db.Exec(string(sqlBytes)); err != nil {
		log.Fatalf("exec: %v", err)
	}
	fmt.Println("[apply] OK")
}
