package cover

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

// DownloadFront fetches 250px front cover for a MusicBrainz release id, saves to dest (jpg).
func DownloadFront(mbid, dest string) error {
	if mbid == "" {
		return fmt.Errorf("no mbid")
	}
	u := "https://coverartarchive.org/release/" + mbid + "/front-500"
	if err := downloadURL(u, dest); err == nil {
		return nil
	}
	u2 := "https://coverartarchive.org/release/" + mbid + "/front-250"
	return downloadURL(u2, dest)
}

func downloadURL(u, dest string) error {
	c := &http.Client{}
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	req.Header.Set("User-Agent", "MusicSH/0.1 ( cover fetch )")
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("http %d", resp.StatusCode)
	}
	_ = os.MkdirAll(filepath.Dir(dest), 0o755)
	f, err := os.CreateTemp(filepath.Dir(dest), "cov-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	_, err = io.Copy(f, io.LimitReader(resp.Body, 8<<20))
	_ = f.Close()
	if err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dest)
}
