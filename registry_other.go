//go:build !windows

package main

func installRegistry(browserByte, jsonPath string) error { return nil }
func uninstallRegistry(browserByte string) error          { return nil }
