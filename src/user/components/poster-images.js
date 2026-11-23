// programs.poster_image 의 키를 포스터 사진으로 바꿉니다. 사진은 Vite 가 해시 주소로 묶어 줍니다.
// 출처는 src/assets/images/CREDITS.md 에 있습니다.
import quartet from '../../assets/images/quartet.jpg';
import theater from '../../assets/images/theater.jpg';
import pottery from '../../assets/images/pottery.jpg';
import makeup from '../../assets/images/makeup.jpg';
import choir from '../../assets/images/choir.jpg';
import watercolor from '../../assets/images/watercolor.jpg';

// position: 3:4 로 잘릴 때 사진에서 남길 부분
const IMAGES = {
  quartet: { src: quartet, position: '50% 50%' },
  theater: { src: theater, position: '50% 40%' },
  pottery: { src: pottery, position: '50% 50%' },
  makeup: { src: makeup, position: '30% 50%' },
  choir: { src: choir, position: '60% 50%' },
  watercolor: { src: watercolor, position: '70% 60%' },
};

// 모르는 키나 빈 값은 사진 없는 포스터(무채색 바탕)로 그립니다.
export function posterImage(key) {
  return Object.hasOwn(IMAGES, key ?? '') ? IMAGES[key] : { src: '', position: '50% 50%' };
}
