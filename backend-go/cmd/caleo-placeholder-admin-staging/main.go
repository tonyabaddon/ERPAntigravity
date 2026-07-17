package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
)

const html = `<!DOCTYPE html><html lang="id"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Caleo — Staging Admin</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:linear-gradient(135deg,#1e3d60,#102a43);color:#fff;text-align:center;padding:20px;margin:0}.container{max-width:500px}h1{font-size:48px;margin-bottom:16px}p{font-size:16px;opacity:0.7}a{color:#6ee7a0;text-decoration:none;font-weight:600}</style>
</head><body><div class="container"><h1>Caleo</h1>
<p>Staging admin — internal only.<br>Log in via <a href="https://app.caleo.id">app.caleo.id</a></p>
</div></body></html>`

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=UTF-8")
		w.Header().Set("Cache-Control", "public, max-age=300")
		fmt.Fprint(w, html)
	})
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
