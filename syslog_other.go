//go:build !windows

package main

import (
	"fmt"
	"log"
	"log/syslog"

	"tailscale.com/types/logger"
)

func trySetSyslog(logf *logger.Logf) {
	w, err := syslog.Dial("tcp", "localhost:5555", syslog.LOG_INFO, "browser")
	if err != nil {
		log.Printf("syslog: %v", err)
		return
	}
	log.Printf("syslog dialed")
	*logf = func(f string, a ...any) {
		fmt.Fprintf(w, f, a...)
	}
	log.SetOutput(w)
}
