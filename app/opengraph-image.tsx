import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Roomful — party games for a room full of people";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#faf6ec",
        }}
      >
        <div style={{ display: "flex", fontSize: 144, fontWeight: 900, letterSpacing: -4 }}>
          <span style={{ color: "#18181b" }}>Room</span>
          <span style={{ color: "#d97706" }}>ful</span>
        </div>
        <div style={{ display: "flex", marginTop: 24, fontSize: 36, color: "#52525b" }}>
          Party games for a room full of people
        </div>
      </div>
    ),
    { ...size },
  );
}
