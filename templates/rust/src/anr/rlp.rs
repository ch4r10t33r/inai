/// Minimal RLP encoder/decoder — sufficient for ANR wire format.

#[derive(Debug, Clone, PartialEq)]
pub enum RlpItem {
    Bytes(Vec<u8>),
    List(Vec<RlpItem>),
}

// ── encode ────────────────────────────────────────────────────────────────────

pub fn rlp_encode(item: &RlpItem) -> Vec<u8> {
    match item {
        RlpItem::Bytes(b) => encode_bytes(b),
        RlpItem::List(l)  => {
            let payload: Vec<u8> = l.iter().flat_map(rlp_encode).collect();
            let mut out = encode_length(payload.len(), 0xC0);
            out.extend(payload);
            out
        }
    }
}

fn encode_bytes(b: &[u8]) -> Vec<u8> {
    if b.len() == 1 && b[0] < 0x80 {
        return b.to_vec();
    }
    let mut out = encode_length(b.len(), 0x80);
    out.extend_from_slice(b);
    out
}

fn encode_length(len: usize, offset: u8) -> Vec<u8> {
    if len < 56 {
        vec![offset + len as u8]
    } else {
        let be: Vec<u8> = {
            let mut n = len;
            let mut bytes = Vec::new();
            while n > 0 { bytes.push(n as u8); n >>= 8; }
            bytes.reverse();
            bytes
        };
        let mut out = vec![offset + 55 + be.len() as u8];
        out.extend(be);
        out
    }
}

// ── decode ────────────────────────────────────────────────────────────────────

#[derive(Debug)]
pub struct RlpError(pub String);
impl std::fmt::Display for RlpError { fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { write!(f, "{}", self.0) } }
impl std::error::Error for RlpError {}

pub fn rlp_decode(data: &[u8]) -> Result<RlpItem, RlpError> {
    let (item, _) = decode_at(data, 0)?;
    Ok(item)
}

fn decode_at(data: &[u8], offset: usize) -> Result<(RlpItem, usize), RlpError> {
    let prefix = *data.get(offset).ok_or_else(|| RlpError("unexpected end".into()))?;

    if prefix < 0x80 {
        return Ok((RlpItem::Bytes(vec![prefix]), offset + 1));
    }
    if prefix <= 0xB7 {
        let len   = (prefix - 0x80) as usize;
        let start = offset + 1;
        return Ok((RlpItem::Bytes(data[start..start + len].to_vec()), start + len));
    }
    if prefix <= 0xBF {
        let ll    = (prefix - 0xB7) as usize;
        let len   = usize_from_be(&data[offset + 1..offset + 1 + ll]);
        let start = offset + 1 + ll;
        return Ok((RlpItem::Bytes(data[start..start + len].to_vec()), start + len));
    }
    if prefix <= 0xF7 {
        let len   = (prefix - 0xC0) as usize;
        let start = offset + 1;
        let items = decode_list(&data[start..start + len])?;
        return Ok((RlpItem::List(items), start + len));
    }
    let ll    = (prefix - 0xF7) as usize;
    let len   = usize_from_be(&data[offset + 1..offset + 1 + ll]);
    let start = offset + 1 + ll;
    let items = decode_list(&data[start..start + len])?;
    Ok((RlpItem::List(items), start + len))
}

fn decode_list(data: &[u8]) -> Result<Vec<RlpItem>, RlpError> {
    let mut items = Vec::new();
    let mut pos = 0;
    while pos < data.len() {
        let (item, next) = decode_at(data, pos)?;
        items.push(item);
        pos = next;
    }
    Ok(items)
}

fn usize_from_be(b: &[u8]) -> usize {
    b.iter().fold(0usize, |acc, &x| (acc << 8) | x as usize)
}
