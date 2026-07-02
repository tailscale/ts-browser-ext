package main

import "tailscale.com/types/logger"

func trySetSyslog(logf *logger.Logf) {
	// syslog is not available on Windows; use default logging.
}
