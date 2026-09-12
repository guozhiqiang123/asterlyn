use asterlyn_git::GitError;
use base64::Engine;

pub(crate) const IMAGE_PREVIEW_LIMIT_BYTES: usize = 16 * 1024 * 1024;
const IMAGE_PREVIEW_LIMIT_PIXELS: u64 = 16_000_000;
const IMAGE_DIFF_LIMIT_PIXELS: u64 = 24_000_000;

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImagePreview {
    pub(crate) path: String,
    pub(crate) media_type: String,
    pub(crate) data_url: String,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) byte_length: usize,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageDiffPreview {
    pub(crate) path: String,
    pub(crate) before: Option<ImagePreview>,
    pub(crate) after: Option<ImagePreview>,
}

pub(crate) fn encode_image_diff(
    path: String,
    before: Option<Vec<u8>>,
    after: Option<Vec<u8>>,
) -> Result<ImageDiffPreview, GitError> {
    let before = before
        .map(|bytes| encode_image_preview(&path, bytes))
        .transpose()
        .map_err(image_preview_git_error)?;
    let after = after
        .map(|bytes| encode_image_preview(&path, bytes))
        .transpose()
        .map_err(image_preview_git_error)?;
    let pixels = before
        .as_ref()
        .map(image_pixels)
        .unwrap_or(0)
        .saturating_add(after.as_ref().map(image_pixels).unwrap_or(0));
    if pixels > IMAGE_DIFF_LIMIT_PIXELS {
        return Err(image_preview_git_error(format!(
            "image Diff is limited to {IMAGE_DIFF_LIMIT_PIXELS} decoded pixels across both sides"
        )));
    }
    Ok(ImageDiffPreview {
        path,
        before,
        after,
    })
}

fn image_preview_git_error(message: String) -> GitError {
    GitError::InvalidInput {
        field: "image preview".to_string(),
        message,
    }
}

fn image_pixels(image: &ImagePreview) -> u64 {
    u64::from(image.width).saturating_mul(u64::from(image.height))
}

pub(crate) fn encode_image_preview(path: &str, bytes: Vec<u8>) -> Result<ImagePreview, String> {
    if bytes.len() > IMAGE_PREVIEW_LIMIT_BYTES {
        return Err(format!(
            "image preview is limited to {IMAGE_PREVIEW_LIMIT_BYTES} bytes per file"
        ));
    }
    let (media_type, width, height) = inspect_image(&bytes)?;
    let pixels = u64::from(width).saturating_mul(u64::from(height));
    if width == 0 || height == 0 || pixels > IMAGE_PREVIEW_LIMIT_PIXELS {
        return Err(format!(
            "image preview is limited to {IMAGE_PREVIEW_LIMIT_PIXELS} decoded pixels per file"
        ));
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(ImagePreview {
        path: path.to_string(),
        media_type: media_type.to_string(),
        data_url: format!("data:{media_type};base64,{encoded}"),
        width,
        height,
        byte_length: bytes.len(),
    })
}

pub(crate) fn inspect_image(bytes: &[u8]) -> Result<(&'static str, u32, u32), String> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.len() >= 24 {
        if png_has_animation(bytes)? {
            return Err("animated PNG preview is not supported".to_string());
        }
        return Ok((
            "image/png",
            u32::from_be_bytes(bytes[16..20].try_into().expect("PNG width slice")),
            u32::from_be_bytes(bytes[20..24].try_into().expect("PNG height slice")),
        ));
    }
    if bytes.starts_with(b"\xff\xd8") {
        let (width, height) = jpeg_dimensions(bytes)?;
        return Ok(("image/jpeg", width, height));
    }
    if (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) && bytes.len() >= 13 {
        if gif_frame_count(bytes)? > 1 {
            return Err("animated GIF preview is not supported".to_string());
        }
        return Ok((
            "image/gif",
            u32::from(u16::from_le_bytes([bytes[6], bytes[7]])),
            u32::from(u16::from_le_bytes([bytes[8], bytes[9]])),
        ));
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        let (width, height, animated) = webp_dimensions(bytes)?;
        if animated {
            return Err("animated WebP preview is not supported".to_string());
        }
        return Ok(("image/webp", width, height));
    }
    if bytes.starts_with(b"BM") && bytes.len() >= 26 {
        let width = i32::from_le_bytes(bytes[18..22].try_into().expect("BMP width slice"));
        let height = i32::from_le_bytes(bytes[22..26].try_into().expect("BMP height slice"));
        return Ok(("image/bmp", width.unsigned_abs(), height.unsigned_abs()));
    }
    if bytes.starts_with(b"\0\0\x01\0") && bytes.len() >= 6 {
        let count = usize::from(u16::from_le_bytes([bytes[4], bytes[5]]));
        if count == 0 || bytes.len() < 6 + count.saturating_mul(16) {
            return Err("the ICO directory is incomplete".to_string());
        }
        let mut width = 0_u32;
        let mut height = 0_u32;
        for entry in bytes[6..6 + count * 16].chunks_exact(16) {
            width = width.max(if entry[0] == 0 {
                256
            } else {
                u32::from(entry[0])
            });
            height = height.max(if entry[1] == 0 {
                256
            } else {
                u32::from(entry[1])
            });
        }
        return Ok(("image/x-icon", width, height));
    }
    Err("supported image formats are PNG, JPEG, static GIF, static WebP, BMP, and ICO".to_string())
}

fn png_has_animation(bytes: &[u8]) -> Result<bool, String> {
    let mut cursor = 8_usize;
    while cursor + 12 <= bytes.len() {
        let length = u32::from_be_bytes(
            bytes[cursor..cursor + 4]
                .try_into()
                .expect("PNG chunk length slice"),
        ) as usize;
        let end = cursor.saturating_add(12).saturating_add(length);
        if end > bytes.len() {
            return Err("the PNG chunk table is incomplete".to_string());
        }
        let kind = &bytes[cursor + 4..cursor + 8];
        if kind == b"acTL" {
            return Ok(true);
        }
        cursor = end;
        if kind == b"IEND" {
            return Ok(false);
        }
    }
    Err("the PNG end marker is missing".to_string())
}

fn jpeg_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    let mut cursor = 2_usize;
    while cursor + 4 <= bytes.len() {
        if bytes[cursor] != 0xff {
            cursor += 1;
            continue;
        }
        while cursor < bytes.len() && bytes[cursor] == 0xff {
            cursor += 1;
        }
        if cursor >= bytes.len() {
            break;
        }
        let marker = bytes[cursor];
        cursor += 1;
        if marker == 0xd9 || marker == 0xda {
            break;
        }
        if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        if cursor + 2 > bytes.len() {
            break;
        }
        let length = usize::from(u16::from_be_bytes([bytes[cursor], bytes[cursor + 1]]));
        if length < 2 || cursor + length > bytes.len() {
            return Err("the JPEG segment table is incomplete".to_string());
        }
        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            if length < 7 {
                return Err("the JPEG size segment is incomplete".to_string());
            }
            let height = u32::from(u16::from_be_bytes([bytes[cursor + 3], bytes[cursor + 4]]));
            let width = u32::from(u16::from_be_bytes([bytes[cursor + 5], bytes[cursor + 6]]));
            return Ok((width, height));
        }
        cursor += length;
    }
    Err("the JPEG dimensions could not be read".to_string())
}

fn gif_frame_count(bytes: &[u8]) -> Result<usize, String> {
    let packed = bytes[10];
    let table_bytes = if packed & 0x80 != 0 {
        3_usize << ((packed & 0x07) + 1)
    } else {
        0
    };
    let mut cursor = 13_usize.saturating_add(table_bytes);
    let mut frames = 0_usize;
    while cursor < bytes.len() {
        match bytes[cursor] {
            0x3b => return Ok(frames),
            0x2c => {
                frames += 1;
                if frames > 1 {
                    return Ok(frames);
                }
                if cursor + 10 > bytes.len() {
                    return Err("the GIF image descriptor is incomplete".to_string());
                }
                let local = bytes[cursor + 9];
                cursor += 10;
                if local & 0x80 != 0 {
                    cursor = cursor.saturating_add(3_usize << ((local & 0x07) + 1));
                }
                if cursor >= bytes.len() {
                    return Err("the GIF image data is incomplete".to_string());
                }
                cursor += 1;
                cursor = skip_gif_sub_blocks(bytes, cursor)?;
            }
            0x21 => {
                if cursor + 2 > bytes.len() {
                    return Err("the GIF extension is incomplete".to_string());
                }
                cursor = skip_gif_sub_blocks(bytes, cursor + 2)?;
            }
            _ => return Err("the GIF block stream is invalid".to_string()),
        }
    }
    Err("the GIF trailer is missing".to_string())
}

fn skip_gif_sub_blocks(bytes: &[u8], mut cursor: usize) -> Result<usize, String> {
    loop {
        let Some(&length) = bytes.get(cursor) else {
            return Err("the GIF data blocks are incomplete".to_string());
        };
        cursor += 1;
        if length == 0 {
            return Ok(cursor);
        }
        cursor = cursor.saturating_add(usize::from(length));
        if cursor > bytes.len() {
            return Err("the GIF data blocks are incomplete".to_string());
        }
    }
}

fn webp_dimensions(bytes: &[u8]) -> Result<(u32, u32, bool), String> {
    let mut cursor = 12_usize;
    let mut dimensions = None;
    let mut animated = false;
    while cursor + 8 <= bytes.len() {
        let kind = &bytes[cursor..cursor + 4];
        let length = u32::from_le_bytes(
            bytes[cursor + 4..cursor + 8]
                .try_into()
                .expect("WebP length slice"),
        ) as usize;
        let body = cursor + 8;
        let end = body.saturating_add(length);
        if end > bytes.len() {
            return Err("the WebP chunk table is incomplete".to_string());
        }
        if kind == b"ANIM" {
            animated = true;
        } else if kind == b"VP8X" && length >= 10 {
            animated |= bytes[body] & 0x02 != 0;
            let width = 1
                + u32::from(bytes[body + 4])
                + (u32::from(bytes[body + 5]) << 8)
                + (u32::from(bytes[body + 6]) << 16);
            let height = 1
                + u32::from(bytes[body + 7])
                + (u32::from(bytes[body + 8]) << 8)
                + (u32::from(bytes[body + 9]) << 16);
            dimensions = Some((width, height));
        } else if kind == b"VP8 " && length >= 10 && bytes[body + 3..body + 6] == [0x9d, 0x01, 0x2a]
        {
            let width = u32::from(u16::from_le_bytes([bytes[body + 6], bytes[body + 7]]) & 0x3fff);
            let height = u32::from(u16::from_le_bytes([bytes[body + 8], bytes[body + 9]]) & 0x3fff);
            dimensions.get_or_insert((width, height));
        } else if kind == b"VP8L" && length >= 5 && bytes[body] == 0x2f {
            let width = 1 + u32::from(bytes[body + 1]) + (u32::from(bytes[body + 2] & 0x3f) << 8);
            let height = 1
                + u32::from(bytes[body + 2] >> 6)
                + (u32::from(bytes[body + 3]) << 2)
                + (u32::from(bytes[body + 4] & 0x0f) << 10);
            dimensions.get_or_insert((width, height));
        }
        cursor = end.saturating_add(length & 1);
    }
    dimensions
        .map(|(width, height)| (width, height, animated))
        .ok_or_else(|| "the WebP dimensions could not be read".to_string())
}
