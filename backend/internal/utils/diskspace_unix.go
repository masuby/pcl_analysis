//go:build linux || darwin

package utils

import "syscall"

// DiskUsage reports the filesystem holding `path`, in bytes.
//
// Available is what THIS process may actually use, which on most filesystems is
// smaller than Free — the kernel reserves a slice for root. Reporting Free as
// "remaining" would promise space the app cannot have.
func DiskUsage(path string) (total, used, available uint64, err error) {
	var fs syscall.Statfs_t
	if err = syscall.Statfs(path, &fs); err != nil {
		return 0, 0, 0, err
	}
	blockSize := uint64(fs.Bsize)
	total = fs.Blocks * blockSize
	available = fs.Bavail * blockSize
	used = total - (fs.Bfree * blockSize)
	return total, used, available, nil
}
