declare module 'ffprobe-static' {
  const ffprobe: { path: string }
  export default ffprobe
}

declare module 'ffmpeg-static' {
  const ffmpeg: string | null
  export default ffmpeg
}
