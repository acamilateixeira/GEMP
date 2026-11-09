//go:build js && wasm

// Command gemp-wasm runs the comparison in the browser. The online demo
// compiles this file to WebAssembly, so the page calls the same Go code the
// server uses, including the goroutines and the 250 ms deadline per provider.
package main

import (
	"context"
	"encoding/json"
	"strings"
	"syscall/js"

	"github.com/acamilateixeira/GEMP/internal/api"
	"github.com/acamilateixeira/GEMP/internal/credit"
)

func main() {
	providers := credit.DemoProviders()
	compare := js.FuncOf(func(_ js.Value, args []js.Value) any {
		body := ""
		if len(args) > 0 {
			body = args[0].String()
		}
		var executor js.Func
		executor = js.FuncOf(func(_ js.Value, promise []js.Value) any {
			resolve := promise[0]
			// A blocking call inside a JS callback would freeze the page, so the work runs in a goroutine.
			go func() {
				defer executor.Release()
				status, payload, _ := api.Compare(context.Background(), strings.NewReader(body), providers)
				data, err := json.Marshal(payload)
				if err != nil {
					data = []byte(`{"error":"encode_failed"}`)
					status = 500
				}
				resolve.Invoke(map[string]any{"status": status, "body": string(data)})
			}()
			return nil
		})
		return js.Global().Get("Promise").New(executor)
	})
	js.Global().Set("gempCompare", compare)
	js.Global().Call("dispatchEvent", js.Global().Get("Event").New("gemp-ready"))
	select {}
}
