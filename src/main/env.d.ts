/** electron-vite の「?asset」付きの import（ファイルのパスになる） */
declare module '*?asset' {
  const path: string
  export default path
}
