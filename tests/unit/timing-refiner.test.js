import { refineTimings } from '../../js/timing-refiner.js';

describe('Timing Refiner', () => {
    test('Should resolve overlaps by pushing overlapping segments forward', () => {
        const segments = [
            { start: 2.0, end: 5.0, text: 'Hello world', index: 1 },
            { start: 4.0, end: 6.0, text: 'Overlapping', index: 2 },
            { start: 5.5, end: 7.0, text: 'Valid segment', index: 3 }
        ];

        const refined = refineTimings(segments);
        
        expect(refined.length).toBe(3);
        expect(refined[1].start).toBeGreaterThanOrEqual(refined[0].end);
    });

    test('Should trim text that exceeds maximum duration', () => {
        const segments = [
            { start: 0.0, end: 15.0, text: 'Short text.', index: 1 } // 15 seconds for a small text
        ];

        const refined = refineTimings(segments);
        
        expect(refined.length).toBe(1);
        expect(refined[0].end - refined[0].start).toBeLessThan(15.0); // Should be cut down by adjustDuration
    });

    test('Should remove music tags and duplicated segments', () => {
        const segments = [
            { start: 0.0, end: 2.0, text: '[Música] We are here.', index: 1 },
            { start: 3.0, end: 5.0, text: 'We are here.', index: 2 } // Duplicate text
        ];

        const refined = refineTimings(segments);
        
        // The first text should lose "[Música]"
        expect(refined[0].text).toBe('We are here.');
        
        // The second is identical to the first and close in time, so it should be discarded
        expect(refined.length).toBe(1);
        expect(refined[0].end).toBeGreaterThanOrEqual(2.0); // Duration extended
    });
});
