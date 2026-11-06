//Combine octaves: every octave is the full pipeline (noise, spiral blur, final blur) rendered at its own resolution
//--> octave k has 1/2^k of the full resolution, so its noise patterns are 2^k times larger on screen
//--> every octave is sampled bilinearly at the output resolution, then they are added up like regular octaves:
//    the coarsest octave has the weight 1/2, every finer one half of that, the two finest share the smallest weight
//    --> the weights always add up to 1

varying vec2 vScreenUv;

uniform sampler2D tOctave0;
uniform sampler2D tOctave1;
uniform sampler2D tOctave2;
uniform sampler2D tOctave3;
uniform sampler2D tOctave4;
uniform int uOctaveCount;//1..5

void main() {
    //GLSL ES 3.0 can't index sampler arrays with a variable --> one sampler per octave
    
    float factor = exp2(-float(uOctaveCount)) * 2.0;

    float sum = texture(tOctave0, vScreenUv).r * factor;
    
    if (uOctaveCount > 1) sum += texture(tOctave1, vScreenUv).r * factor;

    factor *= 2.0;
    if (uOctaveCount > 2) sum += texture(tOctave2, vScreenUv).r * factor;

    factor *= 2.0;
    if (uOctaveCount > 3) sum += texture(tOctave3, vScreenUv).r * factor;

    factor *= 2.0;
    if (uOctaveCount > 4) sum += texture(tOctave4, vScreenUv).r * factor;

    gl_FragColor = vec4(vec3(sum), 1.0);
}
