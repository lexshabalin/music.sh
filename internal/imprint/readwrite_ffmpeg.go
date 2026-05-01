package imprint

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var reFourDigitYear = regexp.MustCompile(`^\d{4}`)

type ffprobeJSON struct {
	Format *struct {
		Tags map[string]string `json:"tags"`
	} `json:"format"`
	Streams []struct {
		Index     int                    `json:"index"`
		CodecType string                 `json:"codec_type"`
		CodecName string                 `json:"codec_name"`
		Disposition map[string]interface{} `json:"disposition"`
	} `json:"streams"`
}

func ffprobeProbe(ctx context.Context, path string) (ffprobeJSON, error) {
	var out ffprobeJSON
	cmd := exec.CommandContext(ctx, "ffprobe",
		"-v", "error",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		path,
	)
	b, err := cmd.Output()
	if err != nil {
		return out, err
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return out, err
	}
	return out, nil
}

func dispositionTrue(d map[string]interface{}, key string) bool {
	v, ok := d[key]
	if !ok || v == nil {
		return false
	}
	switch x := v.(type) {
	case float64:
		return x != 0
	case bool:
		return x
	case string:
		return x == "1" || strings.EqualFold(x, "true")
	default:
		return false
	}
}

func lowerTagMap(tags map[string]string) map[string]string {
	if len(tags) == 0 {
		return map[string]string{}
	}
	out := make(map[string]string, len(tags))
	for k, v := range tags {
		out[strings.ToLower(strings.TrimSpace(k))] = strings.TrimSpace(v)
	}
	return out
}

func tagPick(m map[string]string, keys ...string) string {
	for _, k := range keys {
		k = strings.ToLower(k)
		if v, ok := m[k]; ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func normalizeYearTag(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if reFourDigitYear.MatchString(s) {
		return s[:4]
	}
	return s
}

func pickCoverStreamIndex(p ffprobeJSON) (int, bool) {
	var attached []int
	var videos []int
	for _, s := range p.Streams {
		if s.CodecType != "video" {
			continue
		}
		videos = append(videos, s.Index)
		if dispositionTrue(s.Disposition, "attached_pic") {
			attached = append(attached, s.Index)
		}
	}
	if len(attached) == 1 {
		return attached[0], true
	}
	if len(attached) > 1 {
		return attached[0], true
	}
	if len(videos) == 1 {
		return videos[0], true
	}
	return 0, false
}

func coverExtForCodec(name string) string {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "png":
		return ".png"
	case "mjpeg", "jpeg", "jpg":
		return ".jpg"
	case "webp":
		return ".webp"
	case "bmp", "image2":
		return ".bmp"
	default:
		return ".img"
	}
}

func extractCoverHash(ctx context.Context, path string, streamIndex int, codecName string) (string, error) {
	ext := coverExtForCodec(codecName)
	f, err := os.CreateTemp("", "musicsh-cover-*"+ext)
	if err != nil {
		return "", err
	}
	outPath := f.Name()
	_ = f.Close()
	defer os.Remove(outPath)

	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-nostdin",
		"-v", "error",
		"-threads", "1",
		"-i", path,
		"-map", fmt.Sprintf("0:%d", streamIndex),
		"-frames:v", "1",
		"-y",
		outPath,
	)
	if err := cmd.Run(); err != nil {
		return "", err
	}
	b, err := os.ReadFile(outPath)
	if err != nil || len(b) == 0 {
		if err == nil {
			err = fmt.Errorf("empty cover extract")
		}
		return "", err
	}
	return hashBytes(b), nil
}

func readFFmpegTags(path string) (currentTags, []string, error) {
	var warn []string
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	p, err := ffprobeProbe(ctx, path)
	if err != nil {
		return currentTags{}, warn, err
	}
	m := map[string]string{}
	if p.Format != nil && p.Format.Tags != nil {
		m = lowerTagMap(p.Format.Tags)
	}

	ct := currentTags{
		title:       tagPick(m, "title", "©nam", "tit2", "name"),
		artist:      tagPick(m, "artist", "©art", "author"),
		album:       tagPick(m, "album", "©alb", "talb"),
		albumArtist: tagPick(m, "album_artist", "albumartist", "album artist", "aartist", "©aart", "band", "tpe2"),
		genre:       tagPick(m, "genre", "©gen", "tcon"),
		composer:    tagPick(m, "composer", "©wrt", "tcom"),
		comment:     tagPick(m, "comment", "description", "©cmt", "synopsis"),
		year:        normalizeYearTag(tagPick(m, "date", "year", "©day", "tyer", "tdrc")),
		trackNo:     tagPick(m, "track", "tracknumber", "trck", "©trk", "trkn"),
		discNo:      tagPick(m, "disc", "discnumber", "disk", "tpos", "part"),
	}

	if idx, ok := pickCoverStreamIndex(p); ok {
		var cn string
		for _, s := range p.Streams {
			if s.Index == idx {
				cn = s.CodecName
				break
			}
		}
		if h, err := extractCoverHash(ctx, path, idx, cn); err == nil {
			ct.coverHash = h
		} else {
			warn = append(warn, "cover extract: "+err.Error())
		}
	}

	return ct, warn, nil
}

func extForCoverTemp(mime string) string {
	switch strings.ToLower(strings.TrimSpace(mime)) {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	default:
		return ".bin"
	}
}

func writeFFmpegTags(path string, desired TrackTarget, writeFields map[Field]bool, coverBytes []byte, coverMime string) ([]string, error) {
	var warn []string
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".musicsh-imprint-*")
	if err != nil {
		return warn, err
	}
	tmpPath := tmp.Name()
	_ = tmp.Close()
	ok := false
	defer func() {
		if ok {
			return
		}
		_ = os.Remove(tmpPath)
	}()

	args := []string{"-y", "-nostdin", "-loglevel", "error", "-i", path}
	coverPath := ""
	if writeFields[FieldCover] && len(coverBytes) > 0 && strings.HasPrefix(coverMime, "image/") {
		cf, err := os.CreateTemp(dir, ".musicsh-cover-in-*"+extForCoverTemp(coverMime))
		if err != nil {
			return warn, err
		}
		coverPath = cf.Name()
		if _, err := cf.Write(coverBytes); err != nil {
			_ = cf.Close()
			os.Remove(coverPath)
			return warn, err
		}
		if err := cf.Close(); err != nil {
			os.Remove(coverPath)
			return warn, err
		}
		defer os.Remove(coverPath)

		args = append(args, "-i", coverPath)
	}
	args = append(args, "-map_metadata", "0")

	// Stream mapping: either full container copy, audio-only (strip covers), or audio+new cover.
	switch {
	case writeFields[FieldCover] && len(coverBytes) == 0:
		args = append(args, "-map", "0:a", "-codec", "copy")
	case writeFields[FieldCover] && len(coverBytes) > 0:
		args = append(args,
			"-map", "0:a",
			"-map", "1",
			"-codec", "copy",
			"-disposition:v:0", "attached_pic",
			"-shortest",
		)
	default:
		args = append(args, "-map", "0", "-codec", "copy")
	}

	if writeFields[FieldTitle] {
		args = append(args, "-metadata", "title="+desired.Title)
	}
	if writeFields[FieldArtist] {
		args = append(args, "-metadata", "artist="+desired.Artist)
	}
	if writeFields[FieldAlbum] {
		args = append(args, "-metadata", "album="+desired.Album)
	}
	if writeFields[FieldAlbumArtist] {
		args = append(args, "-metadata", "album_artist="+desired.AlbumArtist)
	}
	if writeFields[FieldGenre] {
		args = append(args, "-metadata", "genre="+desired.Genre)
	}
	if writeFields[FieldComposer] {
		args = append(args, "-metadata", "composer="+desired.Composer)
	}
	if writeFields[FieldComment] {
		args = append(args, "-metadata", "comment="+desired.Comment)
	}
	if writeFields[FieldYear] {
		if desired.Year != nil {
			args = append(args, "-metadata", fmt.Sprintf("date=%d", *desired.Year))
		} else {
			args = append(args, "-metadata", "date=", "-metadata", "year=")
		}
	}
	if writeFields[FieldTrackNo] {
		if desired.TrackNo != nil {
			args = append(args, "-metadata", fmt.Sprintf("track=%d", *desired.TrackNo))
		} else {
			args = append(args, "-metadata", "track=", "-metadata", "tracknumber=")
		}
	}
	if writeFields[FieldDiscNo] {
		if desired.DiscNo != nil {
			args = append(args, "-metadata", fmt.Sprintf("disc=%d", *desired.DiscNo))
		} else {
			args = append(args, "-metadata", "disc=", "-metadata", "discnumber=")
		}
	}

	args = append(args, tmpPath)

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return warn, fmt.Errorf("ffmpeg: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return warn, err
	}
	ok = true
	return warn, nil
}
