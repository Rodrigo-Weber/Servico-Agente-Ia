import { Composition } from "remotion";
import { SaasPresentationRemotion } from "./SaasPresentationRemotion";

const FPS = 30;
const DURATION_IN_FRAMES = 6 * 5 * FPS;

export const RemotionRoot = () => {
  return (
    <Composition
      id="SaasPresentationRemotion"
      component={SaasPresentationRemotion}
      width={1920}
      height={1080}
      fps={FPS}
      durationInFrames={DURATION_IN_FRAMES}
      defaultProps={{}}
    />
  );
};

