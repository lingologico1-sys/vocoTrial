import { useEffect } from 'react';
import type { FaceKit } from './kit';

/**
 * Decodes a kit's artwork before anything asks to paint it.
 *
 * WHY THIS EXISTS, AND IT IS NOT ABOUT THE FACE. A kit is nine 1024-square PNGs
 * carried as data URLs (see store.ts), and Face.tsx mounts every mouth pose at
 * once and hides the unused ones at `opacity: 0` — deliberately, so that a
 * change of viseme is never a remount and never a blank. The consequence is
 * that a browser has no reason to decode any pose until the first frame that
 * actually shows it, which is a syllable into the tutor's first sentence.
 *
 * So the cost lands in the worst possible place. The diagnostic that found this
 * had nine holes in the audio, eight of them inside the first six seconds of
 * the call and none at all in the ninety seconds of tutor speech that followed:
 * the poses were being decoded one at a time as the mouth first reached for
 * each of them, every decode stalling the main thread, and every stall arriving
 * while that same thread was the only one able to hand the next chunk of audio
 * to the output queue. Once each pose had been decoded once it was cached, and
 * the rest of the lesson played clean.
 *
 * The fix is to spend it early. Nothing here makes the decoding cheaper — it
 * moves it to a moment when the room is silent and a stalled frame costs
 * nobody anything, instead of the middle of a greeting.
 *
 * IT IS BEST EFFORT AND MUST STAY THAT WAY. Every failure here is silent and
 * none of them is worth a line on screen: the artwork still draws, the lesson
 * still runs, and the worst case is the sound it had before this existed. That
 * includes the case where warming simply does not take — this leans on the
 * browser keeping one decoded copy per URL, which is what the data URL makes
 * identical between the element used here and the `<image>` that paints later.
 * That is how engines behave and not something any of them promises.
 */
/**
 * The warmed elements, held alive on purpose, for the one kit being worn.
 *
 * WITHOUT THIS THE WARM-UP IS A NO-OP THAT STILL TYPECHECKS. An `Image` built
 * inside the loop below is unreachable the moment its `decode()` resolves, and
 * a decoded bitmap is exactly the kind of large, reconstructible thing a
 * browser is entitled to release along with the last element referring to it.
 * Nothing would have thrown, nothing would have logged, and the holes would
 * simply still be there — so the elements are kept.
 *
 * ONE KIT AT A TIME, because the memory is not small: nine 1024-square PNGs
 * decode to something over thirty megabytes of bitmap, which is worth holding
 * for the face on screen and not worth holding for every face tried in the
 * studio's picker this afternoon. Warming a new kit releases the last one.
 */
let held: { id: string; images: HTMLImageElement[] } | null = null;

export async function warmKit(kit: FaceKit): Promise<void> {
  // Already the warm one. A re-render, or a page that hands back the same kit,
  // should not spend the decode again.
  if (held?.id === kit.id) return;

  // `original` is deliberately absent: it is the portrait as uploaded, kept so
  // that neutralising stays repeatable, and no call ever paints it. Warming it
  // would decode a megabyte nobody is going to look at.
  const sources = [kit.base, ...Object.values(kit.patches)].filter(
    (source): source is string => typeof source === 'string' && source.length > 0,
  );

  const images = sources.map((source) => {
    const image = new Image();
    image.src = source;
    return image;
  });

  // Claimed before the awaits rather than after, so that two warms racing on a
  // fast face swap cannot both run to completion and leave the loser's images
  // installed over the winner's.
  held = { id: kit.id, images };

  await Promise.all(
    images.map(async (image) => {
      try {
        await image.decode();
      } catch {
        // A patch that will not decode is one that would not have painted
        // either, and Face.tsx already draws a kit with holes in it.
      }
    }),
  );
}

/**
 * Warms whatever kit a page is currently wearing, whenever that changes.
 *
 * A hook rather than a call at each load site because there are five of those
 * between the two pages — a published face, the bundled one, the picker, the
 * studio's own swap — and the one that gets forgotten is the one that puts the
 * holes back. Keyed on the kit itself, so a swap mid-session warms the new
 * artwork and a re-render warms nothing twice.
 */
export function useWarmKit(kit: FaceKit | null | undefined): void {
  useEffect(() => {
    if (!kit) return;
    // Nothing waits on this and nothing reports it: see warmKit on why every
    // failure in here is silent.
    void warmKit(kit);
  }, [kit]);
}
