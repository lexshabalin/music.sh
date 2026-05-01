package coverproc

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	// MaxAlbumCoverSide caps the longer edge after normalization (pixels).
	MaxAlbumCoverSide = 1200
	// MaxJPEGBytes tries to keep embedded covers reasonably small for tags.
	MaxJPEGBytes = 550000
	minJPEGQual  = 62
	startJPEGQual = 88
)

var ErrNotImage = errors.New("not a decodable image")

func decodeImage(r io.Reader) (image.Image, error) {
	im, _, err := image.Decode(r)
	if err != nil {
		return nil, ErrNotImage
	}
	return im, nil
}

func flattenOnWhite(im image.Image) *image.RGBA {
	b := im.Bounds()
	dst := image.NewRGBA(b)
	draw.Draw(dst, b, image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(dst, b, im, b.Min, draw.Over)
	return dst
}

func scaleToMaxSide(src image.Image, maxSide int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return src
	}
	if w <= maxSide && h <= maxSide {
		return src
	}
	var nw, nh int
	if w >= h {
		nw = maxSide
		nh = max(1, int(float64(h)*float64(maxSide)/float64(w)))
	} else {
		nh = maxSide
		nw = max(1, int(float64(w)*float64(maxSide)/float64(h)))
	}
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)
	return dst
}

// NormalizeAlbumCover decodes arbitrary supported formats, composites transparency on white,
// scales down so the longer edge is at most MaxAlbumCoverSide, and returns JPEG bytes.
func NormalizeAlbumCover(r io.Reader) ([]byte, error) {
	limited := io.LimitReader(r, 20<<20)
	raw, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	im, err := decodeImage(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	im = flattenOnWhite(im)
	im = scaleToMaxSide(im, MaxAlbumCoverSide)

	qual := startJPEGQual
	for {
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, im, &jpeg.Options{Quality: qual}); err != nil {
			return nil, err
		}
		out := buf.Bytes()
		if len(out) <= MaxJPEGBytes || qual <= minJPEGQual {
			return out, nil
		}
		qual -= 8
		if qual < minJPEGQual {
			qual = minJPEGQual
		}
	}
}

// NormalizeAlbumCoverFromBytes wraps NormalizeAlbumCover.
func NormalizeAlbumCoverFromBytes(raw []byte) ([]byte, error) {
	return NormalizeAlbumCover(bytes.NewReader(raw))
}
