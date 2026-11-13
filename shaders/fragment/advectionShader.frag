#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;

in vec2 texCoord;
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

in vec2 texCoordXmYp; // left up
in vec2 texCoordXpYm; // right down

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;

uniform vec4 userInputValues; // xpos    Ypos     intensity     Brush Size

#define BRUSH_INTENSITY 2
#define BRUSH_SIZE 3

uniform vec2 userInputMove;  // moveX  moveY
uniform int userInputType;   // 0 = nothing 	1 = temp ...

uniform vec4 airplaneValues; // xpos   Ypos   throttle   fire

uniform bool wrapHorizontally;

uniform float dryLapse;
uniform float evapHeat;
uniform float meltingHeat;
uniform float condensationRate;

uniform float globalEffectsStartAlt;
uniform float globalEffectsEndAlt;
uniform float globalDrying;
uniform float globalHeating;
uniform float soundingForcing;
uniform float waterTemperature;

layout(location = 0) out vec4 base;
layout(location = 1) out vec4 water;
layout(location = 2) out ivec4 wall;

uniform vec2 resolution;

vec2 texelSize;

uniform vec4 initial_Tv[126];
uniform vec4 realWorldSounding_Tv[126];
uniform vec4 realWorldSounding_Wv[126];
uniform vec4 realWorldSounding_Velv[126];

float getInitialT(int y) { return initial_Tv[y / 4][y % 4]; }
float getRealWorldSounding_T(int y) { return (realWorldSounding_Tv[y / 4][y % 4] + realWorldSounding_Tv[(y - 1) / 4][(y - 1) % 4]) / 2.; }
float getRealWorldSounding_W(int y) { return (realWorldSounding_Wv[y / 4][y % 4] + realWorldSounding_Wv[(y - 1) / 4][(y - 1) % 4]) / 2.; }
float getRealWorldSounding_Vel(int y) { return (realWorldSounding_Velv[y / 4][y % 4] + realWorldSounding_Velv[(y - 1) / 4][(y - 1) % 4]) / 2.; }

#include "common.glsl"

void main()
{
  wall = texture(wallTex, texCoord);
  // [HYDROSTATIC WATER FIX] Khởi tạo water từ texture gốc để bảo toàn kênh .z (waterMass) cho cả ô không khí lẫn ô nước
  water = texture(waterTex, texCoord);

  texelSize = vec2(1.) / resolution;

  float actualTempChange = 0.0, realTemp;

  if (wall[DISTANCE] != 0) { // not wall

    vec4 cellX0Y0 = texture(baseTex, texCoord);
    vec4 cellXmY0 = texture(baseTex, texCoordXmY0);
    vec4 cellX0Ym = texture(baseTex, texCoordX0Ym);
    vec4 cellXpY0 = texture(baseTex, texCoordXpY0);
    vec4 cellX0Yp = texture(baseTex, texCoordX0Yp);

    vec4 cellXmYp = texture(baseTex, texCoordXmYp);
    vec4 cellXpYm = texture(baseTex, texCoordXpYm);

    // calculate velocities for different positions within cell
    vec2 velAtP = vec2((cellXmY0.x + cellX0Y0.x) / 2.,
                       (cellX0Ym.y + cellX0Y0.y) / 2.);                                        // center of cell
    vec2 velAtVx = vec2(cellX0Y0.x, (cellX0Ym.y + cellXpY0.y + cellX0Y0.y + cellXpYm.y) / 4.); // midle of right edge of cell
    vec2 velAtVy = vec2((cellXmY0.x + cellX0Yp.x + cellXmYp.x + cellX0Y0.x) / 4.,
                        cellX0Y0.y);                                                           // midle of top edge of cell

    // ADVECT AIR:

    base[VX] = bilerp(baseTex, fragCoord - velAtVx).x;
    base[VY] = bilerp(baseTex, fragCoord - velAtVy).y;

    base[PRESSURE] = bilerpWall(baseTex, wallTex, fragCoord - velAtP)[PRESSURE];
    base[TEMPERATURE] = bilerpWall(baseTex, wallTex, fragCoord - velAtP)[TEMPERATURE];

    // Chỉ nội suy hơi ẩm (x), mây (y), khói (w) — giữ nguyên kênh z (waterMass) không bị gió thổi mất
    water.xyw = bilerpWall(waterTex, wallTex, fragCoord - velAtP).xyw;

    realTemp = potentialToRealT(base[TEMPERATURE]);

    float excessWater = water[TOTAL] - maxWater(realTemp);
    float overSaturation = excessWater - water[CLOUD];

    float condensation;

    if (overSaturation < 0.) {
      condensation = overSaturation * 0.20;
    } else {
      condensation = overSaturation * condensationRate;
    }
    condensation = max(condensation, -water[CLOUD]);

    float dT = condensation * evapHeat * 1.0;
    base[TEMPERATURE] += dT;
    realTemp += dT;
    water[CLOUD] += condensation;

    if (texCoord.y > globalEffectsStartAlt && texCoord.y < globalEffectsEndAlt) {
      water[TOTAL] -= clamp(globalDrying, 0., max(water[TOTAL] - maxWater(max(realTemp - 20.0, CtoK(-80.))), 0.));

      base[TEMPERATURE] += globalHeating;

      int soundingArrayindex = int(texCoord.y * (1.0 / texelSize.y));

      float Tdiff = base[TEMPERATURE] - getRealWorldSounding_T(soundingArrayindex);
      base[TEMPERATURE] -= Tdiff * 0.001 * soundingForcing;

      float Wdiff = water[TOTAL] - getRealWorldSounding_W(soundingArrayindex);
      water[TOTAL] -= Wdiff * 0.001 * soundingForcing;

      base.xy *= 1.0 - map_rangeC(soundingForcing, 0.1, 1.0, 0.0, 0.001);

      float velDiff = base[VX] - getRealWorldSounding_Vel(soundingArrayindex);
      base[VX] -= velDiff * map_rangeC(soundingForcing, 0.9, 1.0, 0.0, 0.001);
    }

    water[TOTAL] = max(water[TOTAL], 0.0);

  } else { // this is wall

    base = texture(baseTex, texCoord);
    water = texture(waterTex, texCoord);

    // [HYDROSTATIC WATER FIX] Nếu là nước lỏng, giữ nguyên toàn bộ trạng thái water & nhiệt độ, không chạy logic đất/tuyết
    if (wall[TYPE] != WALLTYPE_WATER) {
      if (wall[TYPE] == WALLTYPE_LAND) {
        base[TEMPERATURE] = 1000.0;
      }

      ivec4 wallX0Yp = texture(wallTex, texCoordX0Yp);

      wall[VEGETATION] = max(wall[VEGETATION], 0);
      water[SOIL_MOISTURE] = max(water[SOIL_MOISTURE], 0.0);

      if (wallX0Yp[DISTANCE] != 0) {
        vec4 baseX0Yp = texture(baseTex, texCoordX0Yp);
        vec4 waterX0Yp = texture(waterTex, texCoordX0Yp);

        float tempC = KtoC(potentialToRealT(baseX0Yp[TEMPERATURE]));

        if (water[SNOW] > 0.0 && tempC > 0.0) {
          float melting = min(tempC * snowMeltRate, water[SNOW]);
          water[SNOW] -= melting;
          base[TEMPERATURE] += melting / snowMassToHeight * meltingHeat;
          water[SOIL_MOISTURE] += melting;
        }

        if (water[SOIL_MOISTURE] > 0.0 && tempC > 0.0) {
          float evaporation = max((maxWater(CtoK(tempC)) - water[TOTAL]) * 0.00001, 0.);
          water[SOIL_MOISTURE] -= evaporation;
        }
      }
    }
  }

  // USER INPUT:

  bool inBrush = false;
  float weight = 1.0;

  if (userInputValues.x < -0.5) {
    if (abs(userInputValues.y - texCoord.y) < userInputValues[BRUSH_SIZE] * texelSize.y)
      inBrush = true;
  } else {
    vec2 vecFromMouse;

    if (wrapHorizontally) {
      vecFromMouse = vec2(absHorizontalDist(userInputValues.x, texCoord.x), userInputValues.y - texCoord.y);
    } else {
      vecFromMouse = vec2(abs(userInputValues.x - texCoord.x), userInputValues.y - texCoord.y);
    }

    vecFromMouse.x *= texelSize.y / texelSize.x;

    float distFromMouse = length(vecFromMouse);

    weight = smoothstep(userInputValues[BRUSH_SIZE] * texelSize.y, 0., distFromMouse);

    if (distFromMouse < userInputValues[BRUSH_SIZE] * texelSize.y) {
      inBrush = true;
    }
  }

  if (inBrush) {
    if (userInputType == 1) {
      base[3] += userInputValues[BRUSH_INTENSITY];
      base[3] = max(base[3], CtoK(-100.0));
      if (wall[TYPE] == 2 && wall[DISTANCE] == 0)
        base[3] = clamp(base[TEMPERATURE], CtoK(0.0), CtoK(maxWaterTemp));
    } else if (userInputType == 2) {
      float cloudWaterChange = userInputValues[BRUSH_INTENSITY];
      if (water[CLOUD] > 0.0) {
        water[CLOUD] += cloudWaterChange;
        water[CLOUD] = max(water[CLOUD], 0.0);
      }
      water[TOTAL] += cloudWaterChange;
      water[TOTAL] = max(water[TOTAL], 0.0);
    } else if (userInputType == 3 && wall[DISTANCE] != 0) {
      water[SMOKE] += userInputValues[BRUSH_INTENSITY];
      water[SMOKE] = min(max(water[SMOKE], 0.0), 2.0);
    } else if (userInputType == 4) {
      if (userInputValues.x < -0.5) {
        base.x += userInputMove.x * 5.0 * weight * userInputValues[BRUSH_INTENSITY];
      } else {
        base.xy += userInputMove * 5.0 * weight * userInputValues[BRUSH_INTENSITY];
      }
    } else if (userInputType == 9) { // Eraser
      if (wall[DISTANCE] == 0 && texCoord.y > texelSize.y) {
        wall[DISTANCE] = 255;
        wall[TYPE] = WALLTYPE_INERT;
        wall[VEGETATION] = 0;
        base[VX] = 0.0;
        base[VY] = 0.0;
        base[PRESSURE] = 0.0;
        base[TEMPERATURE] = getInitialT(int(texCoord.y * (1.0 / texelSize.y)));
        water = vec4(0.0);
      } else if (wall[DISTANCE] != 0) {
        water[CLOUD] = 0.0;
        water[TOTAL] = 0.0;
        water[PRECIPITATION] = 0.0;
        water[SMOKE] = 0.0;
        water[SOIL_MOISTURE] = 0.0; // Xóa sạch cả giọt nước li ti còn sót
        base.xy = vec2(0.0);
      }
    } else if (userInputType >= 10) {
      if (userInputValues[BRUSH_INTENSITY] > 0.0) {

        bool setWall = false;

        switch (userInputType) {
        case 10:
          wall[TYPE] = WALLTYPE_INERT;
          setWall = true;
          break;
        case 11:
          wall[TYPE] = WALLTYPE_LAND;
          setWall = true;
          break;
        case 12:
          // [HYDROSTATIC WATER FIX] Chỉ đổ nước vào ô trống (không đè mất địa hình đất có sẵn)
          if (wall[DISTANCE] != 0 || wall[TYPE] == WALLTYPE_WATER) {
            wall[TYPE] = WALLTYPE_WATER;
            setWall = true;
          }
          break;
        case 13:
          if (wall[DISTANCE] == 0 && wall[TYPE] == WALLTYPE_LAND && texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) {
            wall[TYPE] = WALLTYPE_FIRE;
            setWall = true;
          }
          break;
        case 14:
          if (wall[DISTANCE] == 0 && (wall[TYPE] == WALLTYPE_LAND || wall[TYPE] == WALLTYPE_RUNWAY || wall[TYPE] == WALLTYPE_INDUSTRIAL) &&
              texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) {
            wall[TYPE] = WALLTYPE_URBAN;
          }
          break;
        case 15:
          if (wall[DISTANCE] == 0 && (wall[TYPE] == WALLTYPE_LAND || wall[TYPE] == WALLTYPE_URBAN || wall[TYPE] == WALLTYPE_INDUSTRIAL) &&
              texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) {
            wall[TYPE] = WALLTYPE_RUNWAY;
          }
          break;
        case 16:
          if (wall[DISTANCE] == 0 && (wall[TYPE] == WALLTYPE_LAND || wall[TYPE] == WALLTYPE_URBAN || wall[TYPE] == WALLTYPE_RUNWAY) &&
              texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) {
            wall[TYPE] = WALLTYPE_INDUSTRIAL;
          }
          break;
        case 20:
          if (wall[DISTANCE] == 0 && wall[TYPE] != WALLTYPE_WATER && texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) {
            water[SOIL_MOISTURE] += userInputValues[BRUSH_INTENSITY] * 10.0;
          }
          break;
        case 21:
          if (wall[DISTANCE] == 0 && (wall[TYPE] == WALLTYPE_LAND || wall[TYPE] == WALLTYPE_URBAN || wall[TYPE] == WALLTYPE_INDUSTRIAL) &&
              texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) {
            water[SNOW] += userInputValues[BRUSH_INTENSITY] * 0.5;
          }
          break;
        case 22:
          if (wall[DISTANCE] == 0 && (wall[TYPE] == WALLTYPE_LAND || wall[TYPE] == WALLTYPE_FIRE || wall[TYPE] == WALLTYPE_URBAN || wall[TYPE] == WALLTYPE_INDUSTRIAL) &&
              texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) {
            wall[VEGETATION] += 1;
          }
          break;
        }

        if (setWall) {
          wall[DISTANCE] = 0;
          base[TEMPERATURE] = 1000.0;

          if (wall[TYPE] == WALLTYPE_LAND) {
            water[SOIL_MOISTURE] = 25.0;
          } else if (wall[TYPE] == WALLTYPE_WATER) {
            base[TEMPERATURE] = waterTemperature;
            // [HYDROSTATIC WATER FIX] Cấp đầy 1.0 đơn vị khối lượng nước khi vẽ Lake / Sea
            water[SOIL_MOISTURE] = 1.0;
          }
        }
      } else {
        if (wall[DISTANCE] == 0) {
          if (userInputType == 13) {
            if (wall[TYPE] == WALLTYPE_FIRE)
              wall[TYPE] = WALLTYPE_LAND;
          } else if (userInputType == 14) {
            if (wall[TYPE] == WALLTYPE_URBAN)
              wall[TYPE] = WALLTYPE_LAND;
          } else if (userInputType == 15) {
            if (wall[TYPE] == WALLTYPE_RUNWAY)
              wall[TYPE] = WALLTYPE_LAND;
          } else if (userInputType == 16) {
            if (wall[TYPE] == WALLTYPE_INDUSTRIAL)
              wall[TYPE] = WALLTYPE_LAND;
          } else if (userInputType == 20) {
            water[SOIL_MOISTURE] += userInputValues[BRUSH_INTENSITY] * 10.0;
          } else if (userInputType == 21) {
            water[SNOW] += userInputValues[BRUSH_INTENSITY] * 0.5;
          } else if (userInputType == 22) {
            wall[VEGETATION] = max(wall[VEGETATION] - 1, 0);
          } else if (texCoord.y > texelSize.y) {
            wall[DISTANCE] = 255;
            base[VX] = 0.0;
            base[VY] = 0.0;
            base[PRESSURE] = 0.0;
            base[TEMPERATURE] = getInitialT(int(texCoord.y * (1.0 / texelSize.y)));
            water = vec4(0.0);
          }
        }
      }
    }
  }

  if (wall[DISTANCE] == 0) {
    if (wall[TYPE] == WALLTYPE_WATER) {
      water[TOTAL] = 1002.;
    } else {
      water[TOTAL] = 1001.;
    }
  }

  vec2 vecFromPlane;

  if (wrapHorizontally) {
    vecFromPlane = vec2(absHorizontalDist(airplaneValues.x, texCoord.x), airplaneValues.y - texCoord.y);
  } else {
    vecFromPlane = vec2(abs(airplaneValues.x - texCoord.x), airplaneValues.y - texCoord.y);
  }

  vecFromPlane.x *= texelSize.y / texelSize.x;
  vecFromPlane *= resolution.y;

  if (airplaneValues[3] < 0.0)
    vecFromPlane += vec2(0., -1.);

  float distFromPlane = length(vecFromPlane);
  float planeInfluence = max(1.0 - distFromPlane, 0.) * 0.03;

  if (airplaneValues[3] < 0.0) {
    water[PRECIPITATION] += planeInfluence * 100.0;
  }

  if (airplaneValues[3] > 0.9) {
    if (distFromPlane < 1.5) {
      if (wall[DISTANCE] == 0) {
        if (wall[TYPE] == WALLTYPE_LAND && wall[VERT_DISTANCE] == 0)
          wall[TYPE] = WALLTYPE_FIRE;
      } else {
        base[PRESSURE] += 0.05;
        base[TEMPERATURE] = CtoK(50.0);
        water[TOTAL] += 1.;
        water[SMOKE] += 10.;
      }
    }
  }
}