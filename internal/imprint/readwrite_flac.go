package imprint

import (
	"fmt"
	"strings"

	"github.com/go-flac/flacpicture"
	"github.com/go-flac/flacvorbis"
	"github.com/go-flac/go-flac"
)

type flacTags struct {
	Title   string
	Artist  string
	Album   string
	Year    string
	TrackNo string
	DiscNo  string
	CoverHash string
}

func readFLACTags(path string) (flacTags, []string, error) {
	var warn []string
	f, err := flac.ParseFile(path)
	if err != nil {
		return flacTags{}, warn, err
	}
	var vc *flacvorbis.MetadataBlockVorbisComment
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
		out.Title = strings.TrimSpace(string(firstVorbis(vc, flacvorbis.FIELD_TITLE)))
		out.Artist = strings.TrimSpace(string(firstVorbis(vc, flacvorbis.FIELD_ARTIST)))
		out.Album = strings.TrimSpace(string(firstVorbis(vc, flacvorbis.FIELD_ALBUM)))
		// DATE is most common, YEAR also exists; read both
		date := strings.TrimSpace(string(firstVorbis(vc, flacvorbis.FIELD_DATE)))
		if date == "" {
			date = strings.TrimSpace(string(firstVorbis(vc, "YEAR")))
		}
		out.Year = date
		out.TrackNo = strings.TrimSpace(string(firstVorbis(vc, flacvorbis.FIELD_TRACKNUMBER)))
		out.DiscNo = strings.TrimSpace(string(firstVorbis(vc, "DISCNUMBER")))
	}
	return out, warn, nil
}

func firstVorbis(vc *flacvorbis.MetadataBlockVorbisComment, key string) []byte {
	if vc == nil {
		return nil
	}
	vs := vc.Get(key)
	if len(vs) == 0 {
		return nil
	}
	return vs[0]
}

func writeFLACTags(path string, desired TrackTarget, writeFields map[Field]bool, coverBytes []byte, coverMime string) ([]string, error) {
	var warn []string
	f, err := flac.ParseFile(path)
	if err != nil {
		return warn, err
	}

	var vc *flacvorbis.MetadataBlockVorbisComment
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
		vc.Set(flacvorbis.FIELD_TITLE, []byte(desired.Title))
	}
	if writeFields[FieldArtist] {
		vc.Set(flacvorbis.FIELD_ARTIST, []byte(desired.Artist))
	}
	if writeFields[FieldAlbum] {
		vc.Set(flacvorbis.FIELD_ALBUM, []byte(desired.Album))
	}
	if writeFields[FieldYear] {
		if desired.Year != nil {
			vc.Set(flacvorbis.FIELD_DATE, []byte(fmt.Sprintf("%d", *desired.Year)))
		} else {
			vc.Delete(flacvorbis.FIELD_DATE)
		}
	}
	if writeFields[FieldTrackNo] {
		if desired.TrackNo != nil {
			vc.Set(flacvorbis.FIELD_TRACKNUMBER, []byte(fmt.Sprintf("%d", *desired.TrackNo)))
		} else {
			vc.Delete(flacvorbis.FIELD_TRACKNUMBER)
		}
	}
	if writeFields[FieldDiscNo] {
		if desired.DiscNo != nil {
			vc.Set("DISCNUMBER", []byte(fmt.Sprintf("%d", *desired.DiscNo)))
		} else {
			vc.Delete("DISCNUMBER")
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

