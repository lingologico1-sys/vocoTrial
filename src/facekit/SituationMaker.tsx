import FaceKit from './FaceKit';

/**
 * The same authoring flow, for a person in a setting rather than a head.
 *
 * A page rather than a checkbox on faceKit, because the two are different
 * intentions arriving with different pictures, and the choice has to be made
 * before the upload rather than after it. Framing is the one decision here that
 * cannot be revised — a scene shot too wide gives the mouth too few pixels, and
 * no amount of dragging a rectangle over the face afterwards puts detail back
 * that the framing never gave it. A page can say that above the file picker. A
 * checkbox halfway down a form is read after the file has been chosen.
 *
 * It is also what the kit's `situation` flag means, which is not a preference:
 * it tells Face.tsx to hold the picture still, because the head motion that
 * reads as emphasis on a portrait reads as an earthquake on a room. See
 * FaceKit.situation in facekit/kit.ts, and the two gates in live/Face.tsx.
 *
 * Deliberately thin. Everything below it — the boxes, the slots, the library,
 * the publish path — is the faceKit component with one prop set, so a change to
 * the flow lands on both pages at once and neither can drift into being the one
 * that still works.
 */
export default function SituationMaker() {
  return <FaceKit situation />;
}
