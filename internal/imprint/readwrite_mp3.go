package imprint

import (
	"fmt"
	"os"
	"strings"

	"github.com/bogem/id3v2/v2"
)

type mp3Tags struct {
	Title       string
	Artist      string
	Album       string
	AlbumArtist string
	Genre       string
	Composer    string
	Comment     string
	Year        string
	TrackNo     string
	DiscNo      string

	CoverHash string
}

func readMP3Tags(path string) (mp3Tags, []string, error) {
	var warn []string
	tag, err := id3v2.Open(path, id3v2.Options{Parse: true})
	if err != nil {
		return mp3Tags{}, warn, err
	}
	defer tag.Close()

	out := mp3Tags{
		Title:       strings.TrimSpace(tag.Title()),
		Artist:      strings.TrimSpace(tag.Artist()),
		Album:       strings.TrimSpace(tag.Album()),
		AlbumArtist: strings.TrimSpace(tag.GetTextFrame(tag.CommonID("Band/Orchestra/Accompaniment")).Text),
		Genre:       strings.TrimSpace(tag.Genre()),
		Composer:    strings.TrimSpace(tag.GetTextFrame(tag.CommonID("Composer")).Text),
		Year:        strings.TrimSpace(tag.Year()),
	}
	for _, fr := range tag.GetFrames(tag.CommonID("Comments")) {
		if cf, ok := fr.(id3v2.CommentFrame); ok {
			txt := strings.TrimSpace(cf.Text)
			if txt == "" {
				continue
			}
			if out.Comment == "" {
				out.Comment = txt
			} else {
				out.Comment += "\n" + txt
			}
		}
	}

	// TRCK/TPOS are text frames; id3v2 has helpers only for common ones, so fetch raw.
	if frs := tag.GetFrames("TRCK"); len(frs) > 0 {
		if tf, ok := frs[0].(id3v2.TextFrame); ok {
			out.TrackNo = strings.TrimSpace(tf.Text)
		}
	}
	if frs := tag.GetFrames("TPOS"); len(frs) > 0 {
		if tf, ok := frs[0].(id3v2.TextFrame); ok {
			out.DiscNo = strings.TrimSpace(tf.Text)
		}
	}

	if frs := tag.GetFrames(tag.CommonID("Attached picture")); len(frs) > 0 {
		if pf, ok := frs[0].(id3v2.PictureFrame); ok && len(pf.Picture) > 0 {
			out.CoverHash = hashBytes(pf.Picture)
		}
	}

	_ = warn
	return out, warn, nil
}

func writeMP3Tags(path string, desired TrackTarget, writeFields map[Field]bool, coverBytes []byte, coverMime string) ([]string, error) {
	var warn []string

	// ensure file is writable early for clearer errors
	f, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return warn, err
	}
	_ = f.Close()

	tag, err := id3v2.Open(path, id3v2.Options{Parse: true})
	if err != nil {
		return warn, err
	}
	defer tag.Close()

	if writeFields[FieldTitle] {
		tag.SetTitle(desired.Title)
	}
	if writeFields[FieldArtist] {
		tag.SetArtist(desired.Artist)
	}
	if writeFields[FieldAlbum] {
		tag.SetAlbum(desired.Album)
	}
	if writeFields[FieldAlbumArtist] {
		aa := tag.CommonID("Band/Orchestra/Accompaniment")
		tag.DeleteFrames(aa)
		if strings.TrimSpace(desired.AlbumArtist) != "" {
			tag.AddTextFrame(aa, tag.DefaultEncoding(), strings.TrimSpace(desired.AlbumArtist))
		}
	}
	if writeFields[FieldGenre] {
		gid := tag.CommonID("Content type")
		tag.DeleteFrames(gid)
		if strings.TrimSpace(desired.Genre) != "" {
			tag.AddTextFrame(gid, tag.DefaultEncoding(), strings.TrimSpace(desired.Genre))
		}
	}
	if writeFields[FieldComposer] {
		cid := tag.CommonID("Composer")
		tag.DeleteFrames(cid)
		if strings.TrimSpace(desired.Composer) != "" {
			tag.AddTextFrame(cid, tag.DefaultEncoding(), strings.TrimSpace(desired.Composer))
		}
	}
	if writeFields[FieldComment] {
		cfid := tag.CommonID("Comments")
		tag.DeleteFrames(cfid)
		if strings.TrimSpace(desired.Comment) != "" {
			tag.AddCommentFrame(id3v2.CommentFrame{
				Encoding:    tag.DefaultEncoding(),
				Language:    "eng",
				Description: "",
				Text:        strings.TrimSpace(desired.Comment),
			})
		}
	}
	if writeFields[FieldYear] {
		if desired.Year != nil {
			tag.SetYear(fmt.Sprintf("%d", *desired.Year))
		} else {
			// clear by setting empty
			tag.SetYear("")
		}
	}
	if writeFields[FieldTrackNo] {
		tag.DeleteFrames("TRCK")
		if desired.TrackNo != nil {
			tag.AddFrame("TRCK", id3v2.TextFrame{Encoding: tag.DefaultEncoding(), Text: fmt.Sprintf("%d", *desired.TrackNo)})
		}
	}
	if writeFields[FieldDiscNo] {
		tag.DeleteFrames("TPOS")
		if desired.DiscNo != nil {
			tag.AddFrame("TPOS", id3v2.TextFrame{Encoding: tag.DefaultEncoding(), Text: fmt.Sprintf("%d", *desired.DiscNo)})
		}
	}
	if writeFields[FieldCover] {
		tag.DeleteFrames(tag.CommonID("Attached picture"))
		if len(coverBytes) > 0 && strings.HasPrefix(coverMime, "image/") {
			p := id3v2.PictureFrame{
				Encoding:    tag.DefaultEncoding(),
				MimeType:    coverMime,
				PictureType: id3v2.PTFrontCover,
				Description: "Front cover",
				Picture:     coverBytes,
			}
			tag.AddAttachedPicture(p)
		}
	}

	if err := tag.Save(); err != nil {
		return warn, err
	}
	return warn, nil
}

