package imprint

import (
	"fmt"
	"strings"

	"github.com/go-flac/flacpicture"
	"github.com/go-flac/flacvorbis"
	"github.com/go-flac/go-flac"
)

type flacTags struct {
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
	CoverHash   string
}

func readFLACTags(path string) (flacTags, []string, error) {
	var warn []string
	f, err := flac.ParseFile(path)
	if err != nil {
		return flacTags{}, warn, err
	}
	var vc *flacvorbis.MetaDataBlockVorbisComment
	out := flacTags{}
	for _, meta := range f.Meta {
		if meta.Type == flac.VorbisComment {
			vc, _ = flacvorbis.ParseFromMetaDataBlock(*meta)
		}
		if meta.Type == flac.Picture {
			pic, e := flacpicture.ParseFromMetaDataBlock(*meta)
			if e == nil && pic != nil && len(pic.ImageData) > 0 && pic.PictureType == flacpicture.PictureTypeFrontCover {
				if out.CoverHash == "" {
					out.CoverHash = hashBytes(pic.ImageData)
				}
			}
		}
	}
	if vc != nil {
		out.Title = strings.TrimSpace(firstVorbis(vc, flacvorbis.FIELD_TITLE))
		out.Artist = strings.TrimSpace(firstVorbis(vc, flacvorbis.FIELD_ARTIST))
		out.Album = strings.TrimSpace(firstVorbis(vc, flacvorbis.FIELD_ALBUM))
		// DATE is most common, YEAR also exists; read both
		date := strings.TrimSpace(firstVorbis(vc, flacvorbis.FIELD_DATE))
		if date == "" {
			date = strings.TrimSpace(firstVorbis(vc, "YEAR"))
		}
		out.Year = date
		out.TrackNo = strings.TrimSpace(firstVorbis(vc, flacvorbis.FIELD_TRACKNUMBER))
		out.DiscNo = strings.TrimSpace(firstVorbis(vc, "DISCNUMBER"))
		out.AlbumArtist = strings.TrimSpace(firstVorbis(vc, "ALBUMARTIST"))
		out.Genre = strings.TrimSpace(firstVorbis(vc, "GENRE"))
		out.Composer = strings.TrimSpace(firstVorbis(vc, "COMPOSER"))
		co := strings.TrimSpace(firstVorbis(vc, "COMMENT"))
		if co == "" {
			co = strings.TrimSpace(firstVorbis(vc, "DESCRIPTION"))
		}
		out.Comment = co
	}
	return out, warn, nil
}

func firstVorbis(vc *flacvorbis.MetaDataBlockVorbisComment, key string) string {
	if vc == nil {
		return ""
	}
	vs, err := vc.Get(key)
	if err != nil || len(vs) == 0 {
		return ""
	}
	return vs[0]
}

func deleteVorbis(vc *flacvorbis.MetaDataBlockVorbisComment, key string) {
	if vc == nil {
		return
	}
	var kept []string
	for _, cmt := range vc.Comments {
		parts := strings.SplitN(cmt, "=", 2)
		if len(parts) != 2 {
			// Keep malformed comment to avoid data loss.
			kept = append(kept, cmt)
			continue
		}
		if strings.EqualFold(parts[0], key) {
			continue
		}
		kept = append(kept, cmt)
	}
	vc.Comments = kept
}

func setVorbis(vc *flacvorbis.MetaDataBlockVorbisComment, key, val string) error {
	if vc == nil {
		return fmt.Errorf("nil vorbis comment")
	}
	deleteVorbis(vc, key)
	return vc.Add(key, val)
}

func writeFLACTags(path string, desired TrackTarget, writeFields map[Field]bool, coverBytes []byte, coverMime string) ([]string, error) {
	var warn []string
	f, err := flac.ParseFile(path)
	if err != nil {
		return warn, err
	}

	var vc *flacvorbis.MetaDataBlockVorbisComment
	vcIdx := -1
	for idx, meta := range f.Meta {
		if meta.Type == flac.VorbisComment {
			vc, err = flacvorbis.ParseFromMetaDataBlock(*meta)
			if err != nil {
				return warn, err
			}
			vcIdx = idx
		}
	}
	if vc == nil {
		vc = flacvorbis.New()
	}

	if writeFields[FieldTitle] {
		if err := setVorbis(vc, flacvorbis.FIELD_TITLE, desired.Title); err != nil {
			return warn, err
		}
	}
	if writeFields[FieldArtist] {
		if err := setVorbis(vc, flacvorbis.FIELD_ARTIST, desired.Artist); err != nil {
			return warn, err
		}
	}
	if writeFields[FieldAlbum] {
		if err := setVorbis(vc, flacvorbis.FIELD_ALBUM, desired.Album); err != nil {
			return warn, err
		}
	}
	if writeFields[FieldAlbumArtist] {
		if strings.TrimSpace(desired.AlbumArtist) != "" {
			if err := setVorbis(vc, "ALBUMARTIST", desired.AlbumArtist); err != nil {
				return warn, err
			}
		} else {
			deleteVorbis(vc, "ALBUMARTIST")
		}
	}
	if writeFields[FieldGenre] {
		if strings.TrimSpace(desired.Genre) != "" {
			if err := setVorbis(vc, "GENRE", desired.Genre); err != nil {
				return warn, err
			}
		} else {
			deleteVorbis(vc, "GENRE")
		}
	}
	if writeFields[FieldComposer] {
		if strings.TrimSpace(desired.Composer) != "" {
			if err := setVorbis(vc, "COMPOSER", desired.Composer); err != nil {
				return warn, err
			}
		} else {
			deleteVorbis(vc, "COMPOSER")
		}
	}
	if writeFields[FieldComment] {
		deleteVorbis(vc, "COMMENT")
		deleteVorbis(vc, "DESCRIPTION")
		if strings.TrimSpace(desired.Comment) != "" {
			if err := setVorbis(vc, "COMMENT", desired.Comment); err != nil {
				return warn, err
			}
		}
	}
	if writeFields[FieldYear] {
		if desired.Year != nil {
			if err := setVorbis(vc, flacvorbis.FIELD_DATE, fmt.Sprintf("%d", *desired.Year)); err != nil {
				return warn, err
			}
		} else {
			deleteVorbis(vc, flacvorbis.FIELD_DATE)
		}
	}
	if writeFields[FieldTrackNo] {
		if desired.TrackNo != nil {
			if err := setVorbis(vc, flacvorbis.FIELD_TRACKNUMBER, fmt.Sprintf("%d", *desired.TrackNo)); err != nil {
				return warn, err
			}
		} else {
			deleteVorbis(vc, flacvorbis.FIELD_TRACKNUMBER)
		}
	}
	if writeFields[FieldDiscNo] {
		if desired.DiscNo != nil {
			if err := setVorbis(vc, "DISCNUMBER", fmt.Sprintf("%d", *desired.DiscNo)); err != nil {
				return warn, err
			}
		} else {
			deleteVorbis(vc, "DISCNUMBER")
		}
	}

	vcMeta := vc.Marshal()
	if vcIdx >= 0 {
		f.Meta[vcIdx] = &vcMeta
	} else {
		f.Meta = append(f.Meta, &vcMeta)
	}

	if writeFields[FieldCover] {
		// Remove existing picture blocks (keep it simple: drop all, then add one).
		var kept []*flac.MetaDataBlock
		for _, meta := range f.Meta {
			if meta.Type != flac.Picture {
				kept = append(kept, meta)
			}
		}
		f.Meta = kept
		if len(coverBytes) > 0 && strings.HasPrefix(coverMime, "image/") {
			pic, err := flacpicture.NewFromImageData(flacpicture.PictureTypeFrontCover, "Front cover", coverBytes, coverMime)
			if err != nil {
				return warn, err
			}
			picMeta := pic.Marshal()
			f.Meta = append(f.Meta, &picMeta)
		}
	}

	if err := f.Save(path); err != nil {
		return warn, err
	}
	return warn, nil
}

