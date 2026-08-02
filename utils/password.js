const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const VERSION = "v1";
const PARAMETERS = Object.freeze({ N: 16384, r: 8, p: 1, keyLength: 64 });
const DUMMY_PASSWORD_HASH = `scrypt$${VERSION}$${PARAMETERS.N}$${PARAMETERS.r}$${PARAMETERS.p}$${Buffer.alloc(16, 7).toString("base64url")}$${Buffer.alloc(PARAMETERS.keyLength).toString("base64url")}`;

async function derive(password, salt, parameters = PARAMETERS) {
  return scrypt(password, salt, parameters.keyLength, {
    N: parameters.N,
    r: parameters.r,
    p: parameters.p,
    maxmem: 64 * 1024 * 1024,
  });
}

async function hashPassword(password) {
  if (typeof password !== "string" || Buffer.byteLength(password, "utf8") > 256) {
    throw new TypeError("password must be a UTF-8 string no longer than 256 bytes");
  }
  const salt = crypto.randomBytes(16);
  const hash = await derive(password, salt);
  return [
    "scrypt", VERSION, PARAMETERS.N, PARAMETERS.r, PARAMETERS.p,
    salt.toString("base64url"), hash.toString("base64url"),
  ].join("$");
}

async function verifyPassword(password, encodedHash) {
  const parts = String(encodedHash || "").split("$");
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== VERSION) return false;
  const parameters = {
    N: Number(parts[2]),
    r: Number(parts[3]),
    p: Number(parts[4]),
    keyLength: 64,
  };
  if (
    parameters.N !== PARAMETERS.N
    || parameters.r !== PARAMETERS.r
    || parameters.p !== PARAMETERS.p
  ) return false;
  try {
    const salt = Buffer.from(parts[5], "base64url");
    const expected = Buffer.from(parts[6], "base64url");
    if (salt.length !== 16 || expected.length !== PARAMETERS.keyLength) return false;
    const actual = await derive(String(password || ""), salt, parameters);
    return crypto.timingSafeEqual(actual, expected);
  } catch (error) {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH, PARAMETERS };
