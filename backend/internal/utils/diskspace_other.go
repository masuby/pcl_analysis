//go:build !linux && !darwin

package utils

import "errors"

// DiskUsage is only implemented for the platforms the API actually ships on
// (the binary is cross-compiled for linux/amd64). This stub exists so the
// package still builds on a developer's Windows machine.
func DiskUsage(path string) (total, used, available uint64, err error) {
	return 0, 0, 0, errors.New("disk usage is not available on this platform")
}
