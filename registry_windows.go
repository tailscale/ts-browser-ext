package main

import "golang.org/x/sys/windows/registry"

func registryKeyPath(browserByte string) string {
	if browserByte == "F" {
		return `Software\Mozilla\NativeMessagingHosts\com.tailscale.browserext.firefox`
	}
	return `Software\Google\Chrome\NativeMessagingHosts\com.tailscale.browserext.chrome`
}

func installRegistry(browserByte, jsonPath string) error {
	key, _, err := registry.CreateKey(registry.CURRENT_USER, registryKeyPath(browserByte), registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	return key.SetStringValue("", jsonPath)
}

func uninstallRegistry(browserByte string) error {
	err := registry.DeleteKey(registry.CURRENT_USER, registryKeyPath(browserByte))
	if err == registry.ErrNotExist {
		return nil
	}
	return err
}
