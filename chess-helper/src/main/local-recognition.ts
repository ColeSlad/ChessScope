import { nativeImage } from "electron";
import { LocalBoardReader, type BoardProfile, type PixelImage } from "../core/local-vision";
import { visionSchema, type BoardObservation, type CapturedFrame, type Orientation } from "../shared/contracts";
import templates from "../data/local-templates.json";

export function decodeLocalImage(dataURL: string): PixelImage {
  const image = nativeImage.createFromDataURL(dataURL);
  const { width, height } = image.getSize(1);
  if (image.isEmpty() || width < 1 || height < 1 || width > 2048 || height > 2048)
    throw new Error("The local board image could not be decoded.");
  // The supported Apple Silicon package uses little-endian BGRA Skia bitmaps.
  const data = image.toBitmap({ scaleFactor: 1 });
  if (data.length !== width * height * 4) throw new Error("Unexpected local image dimensions");
  return { width, height, data, order: "bgra" };
}

export class LocalRecognition {
  private reader = new LocalBoardReader(templates.profiles as BoardProfile[]);
  async recognize(frame: CapturedFrame, orientation: Orientation, signal: AbortSignal): Promise<BoardObservation> {
    signal.throwIfAborted();
    const observed = this.reader.read(decodeLocalImage(frame.image), orientation);
    signal.throwIfAborted();
    return { sessionId: frame.sessionId, revision: frame.revision, frameId: frame.frameId,
      ...visionSchema.parse({ placements: observed.placements, orientation: observed.orientation,
        uncertainSquares: observed.uncertainSquares, boardVisible: observed.boardVisible, cropAligned: observed.cropAligned }) };
  }
}
