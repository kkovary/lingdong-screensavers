""" Hermit screensaver - ported from Lingdong Huang's Hermit (2015)
    Python 3, Pyodide/pygame-ce, async main loop, autopilot.
"""

import sys
import math
import random
import os
import asyncio
import time as _time

import pygame
import numpy

import lib.noise as noise
import lib.tree as tree
import lib.creature as creature
import lib.utilities as u
import lib.filter as filter
import lib.pattern as pattern
import lib.particle as particle
import lib.font as font
import lib.settings as settings

# Callback for JS stats reporting
_stats = {"fps": 0, "frames": 0, "start_time": 0}

# =============================================================================
# INITIALIZATION
# =============================================================================
pygame.init()
settings.init()

# =============================================================================
# VARIABLES
# =============================================================================

## window
size = width, height = 1280, 320
buff = 200
screen = pygame.display.set_mode([width//2, height+50])
canvas = pygame.Surface([width//2, height])

## terrain
# Random start (each launch): forest density, terrain and time of day.
_density = random.uniform(0.8, 1.5)          # >1 = sparser, <1 = denser
treeDensity = int(32*_density)
landDensity = 32
allloads = width//treeDensity
loaded = 0

Ls = [None]*4
Lrs = [None]*4

lspds = [0.1, 0.2, 0.5, 1]
terrain = [random.choice([0, 1])]*4            # 0 = flat forest, 1 = hills (cf. console 'set terrain')
totalMade = [0]*4

locs = [0, 0, 0, 0]
locrs = [width, width, width, width]

land = [0]*(((width)//2)//landDensity+2)
landloc = 0
landni = 0

## style
COLOR_KEY = [255, 0, 255]
scheme = [(70, 69, 63), (225, 225, 210)]
gfont = font.GFont(10, 2)
screen.fill([240, 240, 240])

## game
x = 0
SPEED = 0.5
clock = pygame.time.Clock()
T0 = random.randrange(0, 12566)              # day-night is sin(T*0.0005+1): ~12566 frames, ~7 min
T = T0

## objects
pctrl = particle.ParticleCtrl()

birds = []
deers = []
cranes = []
arrows = []

horse = creature.Horse(100, 0)
horse.yo = height
horse.s = 1
horse.aspd = 0.09
horse.color = (140, 140, 140)

man = creature.Man(150, 0)
man.yo = height
man.s = 0.7
man.color = (140, 140, 140)
man.arrows = arrows
man.walk()

# Autopilot state
_autopilot_drink_cooldown = 0
_autopilot_mount_cooldown = 0

# Spawn director (frames at ~30 fps): something new appears ahead every
# 12-35 s, chosen to suit the current terrain (upstream alternates terrain
# per layer on its own). Caps keep the scene from clogging up.
_spawn_timer = random.randrange(90, 300)
MAX_DEER, MAX_CRANES, MAX_BIRDS = 4, 8, 30


# =============================================================================
# Functions
# =============================================================================

def makeBGLayer(n):
    global loaded, allloads, terrain, lspds, totalMade
    l = pygame.Surface([width+buff*2, height])
    l.fill(COLOR_KEY)
    l.set_colorkey(COLOR_KEY)

    if terrain[n] == 0:
        treesum = width/(0.0+len(Ls)*treeDensity)
        for i in range(0, int(treesum)):
            thetree = [random.choice([tree.tree2]),
                       random.choice([tree.tree1, tree.tree1, tree.tree2]),
                       random.choice([tree.tree1, tree.tree4, tree.tree3]),
                       random.choice([tree.tree1, tree.tree4, tree.tree3])][n]
            thetree(l, random.random()*width+buff, height, (120-n*30)+random.randrange(-10, 10))
            loaded += 1
    elif terrain[n] == 1:
        treesum = (width/(0.0+len(Ls)*treeDensity))
        for i in range(0, int(math.ceil(treesum/2.0))):
            thetree = [random.choice([tree.tree1, tree.tree3]),
                       random.choice([tree.tree1, tree.tree3]),
                       random.choice([tree.tree1, tree.tree3]),
                       random.choice([tree.tree1, tree.tree3])][n]
            thetree(l, random.random()*width+buff, height, (120-n*30)+random.randrange(-10, 10))
            loaded += 2
        if n != 3:
            poly = []
            poly.append([0, height])
            for i in range(buff, width+buff, landDensity):
                poly.append([i, height-makeLand(i*0.05, n*0.5, 500-n*90)])
            poly[1][1] = (poly[1][1]-height)/2.0+height
            poly[-1][1] = (poly[-1][1]-height)/2.0+height
            poly.append([width+buff*2, height])
            pygame.draw.polygon(l, (210-n*20, 210-n*20, 210-n*20), poly)

    totalMade[n] += 1
    if totalMade[n] % max(1, int(lspds[n]*10)) == 0:
        terrain[n] = (terrain[n]+1) % 2
    return l


def mt(LN, *args):
    global Ls, Lrs, loaded, allloads
    allloads = len(args)*(width//(len(Ls)*treeDensity))
    loaded = 0
    if LN == 1:
        for a in args:
            Ls[a] = makeBGLayer(a)
    elif LN == 2:
        for a in args:
            Lrs[a] = makeBGLayer(a)


def makeLand(n, m=0, maxheight=20):
    return max(noise.noise(n*0.1, m*0.5)*maxheight, 2)-2


for landni in range(0, len(land)):
    land[landni] = makeLand(landni, maxheight=20+terrain[3]*120)


def makeBirds(n):
    global birds
    for i in range(0, n):
        b = creature.Bird(random.randrange(width//2+10, width//2+60), 0)
        b.s = 0.5
        b.aspd = 0.3
        b.yo = height
        b.color = (140, 140, 140)
        b.dir = random.choice([1, -1])
        birds.append(b)


def makeDeers(n):
    global deers
    for i in range(0, n):
        r = random.randrange(-5, 5)
        deer = creature.Deer(width//2+landDensity+50+r*10, 0, color=(160+r, 160+r, 160+r))
        deer.yo = height
        deer.s = 1.1
        deer.aspd = 0.15
        deers.append(deer)


def makeCranes(n):
    global cranes
    for j in range(0, n):
        r = random.randrange(-5, 5)
        crane = creature.Crane(width//2+landDensity+random.randrange(0, 200), 0)
        crane.color = (180+r, 180+r, 180+r)
        crane.yo = height-150-120*random.random()
        crane.s = 0.5+random.random()*0.2
        crane.aspd = 0.05
        crane.dir = -1
        crane.t = (j/5.0)*200
        cranes.append(crane)


def onLandY(instx):
    if x == 0:
        ep = -0.01
    else:
        ep = 0.01
    lastAlt = land[int(((x-ep) % landDensity + instx)//landDensity)]
    nextAlt = land[int(((x-ep) % landDensity + instx)//landDensity)+1]
    return lastAlt+(nextAlt-lastAlt)*((((x-ep) % landDensity + instx) % landDensity)/landDensity)


def deerCtrl():
    global deers
    for d in list(deers):
        d.yo = height-30-onLandY(max(min(d.x, width//2), 0))
        if noise.noise(T*0.001, deers.index(d)) < 0.5:
            d.x -= d.spd
            d.walk()
        else:
            d.rest()
        if d.x < -100:
            deers.remove(d)


def craneCtrl():
    global cranes
    for c in list(cranes):
        c.x -= 2*c.s
        c.fly()
        if c.x < -100:
            cranes.remove(c)


def arrowCtrl():
    global arrows
    for a in list(arrows):
        if a.x > width//2 or a.x < -10 or height-onLandY(a.x) >= a.calcHead()[1]:
            a.fly()
        else:
            a.v[0] = 0
            a.v[1] = 0
            a.flicker = 0
        if a.x > width//2:
            arrows.remove(a)


def birdCtrl():
    global birds, arrows, pctrl
    for b in list(birds):
        if b.health > 0:
            if ((abs(man.x - b.x) < 100 and random.random() < 0.05) or random.random() < 0.0002) and b.on == 0:
                b.on = 1
                ra = math.pi/20.0+random.random()*math.pi/6.0*2.1
                rl = random.choice([3, 4, 5])
                b.v = [rl*math.cos(ra), -rl*math.sin(ra)]
            if b.on == 1:
                b.simpFly()
                if abs(man.x - b.x) > 160 and random.random() < 1:
                    b.v[1] = min(b.v[1]+0.05, 0.4)
                if b.y >= 2:
                    b.on = 0
            else:
                b.rest()
                if 0 < b.x < width//2:
                    b.yo = height-3-onLandY(b.x)

            for a in list(arrows):
                if u.dist(a.x, a.y, b.x, b.y+b.yo) < b.s*30 and a.v[0] > 0:
                    a.v[0] /= 2
                    b.arrow = a
                    b.health = 0
                    b.x = a.calcFeather()[0]
                    b.y = a.calcFeather()[1] - b.yo
                    for i in range(0, 12):
                        pctrl.particles.append(particle.Particle(a.calcFeather()[0], a.calcFeather()[1], [8*(random.random()-0.5), 8*(random.random()-0.3)]))

            if b.x < 0 or b.x > width or b.yo < 0:
                birds.remove(b)
        else:
            b.fall()


def drawTitle():
    gfont.s = 10
    gfont.w = 1
    gfont.color = (120, 120, 120)
    gfont.drawStr(canvas, "Hermit", 300-x*0.7, 260)
    gfont.s = 5
    gfont.w = 1
    gfont.color = (120, 120, 120)
    gfont.drawStr(canvas, "by lingdong", 450-x*0.7, 280)


def drawLand():
    global landni, land, landloc
    if -x+landloc < -landDensity:
        landni += 1
        land.append(makeLand(landni, maxheight=20+terrain[3]*120))
        land.pop(0)
        landloc += landDensity
    u.polygon(canvas, (130, 130, 130), [[0, height]]+[[landloc-x+i*landDensity, height-land[i]] for i in range(0, len(land))]+[[width//2, height]])


def drawReflection():
    reflection = canvas
    pygame.draw.rect(screen, (180, 180, 180), [0, height, width//2, 50])
    for i in range(0, 2*(screen.get_height()-height), 2):
        screen.blit(reflection, [(math.sin(i*0.5))*i*0.5+(noise.noise(pygame.time.get_ticks()*0.001, i*0.2)-0.5)*20, height+i-1], (0, height-i, width//2, 1))


def drawFilter():
    array = [pygame.surfarray.pixels_red(screen), pygame.surfarray.pixels_green(screen), pygame.surfarray.pixels_blue(screen)]
    filter.filter(array, T)
    array = []


def draw():
    global Ls, Lrs, locs, locrs, x
    canvas.fill([240, 240, 240])
    for i in range(0, len(Ls)):
        if i == 2:
            for c in cranes:
                c.draw(canvas)
        if i == 3:
            for d in deers:
                d.draw(canvas)
            horse.draw(canvas)
            man.draw(canvas)
            for a in arrows:
                a.draw(canvas)
            for b in birds:
                b.simpDraw(canvas)
            pctrl.draw(canvas)

        if Ls[i] is not None:
            canvas.blit(Ls[i], [locs[i]-x*lspds[i]-buff, 0])

        if locs[i]-x*lspds[i] < -width-buff:
            locs[i] += width*2
            Ls[i] = None
            # Synchronous terrain generation (no threads in Pyodide)
            mt(1, i)

        if Lrs[i] is not None:
            canvas.blit(Lrs[i], [locrs[i]-x*lspds[i]-buff, 0])

        if locrs[i]-x*lspds[i] < -width-buff:
            locrs[i] += width*2
            Lrs[i] = None
            mt(2, i)
    drawLand()


def autopilot_step():
    """Autopilot: walk right, occasionally do interesting things."""
    global x, _autopilot_drink_cooldown, _autopilot_mount_cooldown, _spawn_timer

    _autopilot_drink_cooldown -= 1
    _autopilot_mount_cooldown -= 1

    # Always walking right
    walking = not man.status[0].endswith("ing")

    if walking:
        for a in arrows:
            a.x -= SPEED
        for b in birds:
            b.x -= SPEED
        for p in pctrl.particles:
            p.x -= SPEED
        for d in deers:
            d.x -= SPEED*0.5
        for c in cranes:
            c.x -= SPEED
        x += SPEED
        horse.walk()
        man.walk()

        _spawn_timer -= 1
        if _spawn_timer <= 0:
            _spawn_timer = random.randrange(360, 1050)
            hills = terrain[3] == 1
            choice = random.choice(["cranes", "cranes", "birds"] if hills else ["deer", "deer", "birds"])
            if choice == "deer" and len(deers) < MAX_DEER:
                makeDeers(random.randrange(1, 3))
            elif choice == "cranes" and len(cranes) < MAX_CRANES:
                makeCranes(random.randrange(2, 6))
            elif len(birds) < MAX_BIRDS:
                makeBirds(random.randrange(5, 12))
    else:
        horse.rest()
        man.rest()

    # Occasionally mount/dismount the horse
    if _autopilot_mount_cooldown <= 0:
        if man.status[0] == "" and man.status[1] == "":
            if abs((man.yo-10) - horse.yo) < 10*man.s:
                if random.random() < 0.0003:
                    man.mount(horse)
                    _autopilot_mount_cooldown = 500
        elif man.status[0] == "mounted":
            if random.random() < 0.0002:
                man.dismount(horse)
                _autopilot_mount_cooldown = 500

    # Occasionally drink
    if _autopilot_drink_cooldown <= 0 and man.status[1] == "" and random.random() < 0.0002:
        man.drink()
        _autopilot_drink_cooldown = 400


# =============================================================================
# MAIN
# =============================================================================

# Initial terrain generation (synchronous, replaces threaded loading)
# Random opening cast, suited to the starting terrain.
makeBirds(random.randrange(0, 14))
if terrain[3] == 0:
    makeDeers(random.randrange(0, 3))
else:
    makeCranes(random.randrange(0, 5))
mt(1, 3, 2, 1, 0)
treeDensity = int(16*_density)
mt(2, 3, 2, 1, 0)

_stats["start_time"] = _time.time()


async def main():
    global T
    while True:
        # Process pygame events (needed even without keyboard)
        for event in pygame.event.get():
            pass

        autopilot_step()
        draw()
        clock.tick(30)  # Cap at 30 fps for performance
        T += 1
        _stats["frames"] = T - T0
        _stats["fps"] = clock.get_fps()

        man.yo = height-20-onLandY(man.x)
        horse.yo = height-30-onLandY(horse.x)
        man.animate()
        horse.animate()

        deerCtrl()
        craneCtrl()
        arrowCtrl()
        birdCtrl()

        pctrl.emit()

        screen.blit(canvas, [0, 0])
        drawReflection()
        drawFilter()

        pygame.display.flip()

        # Yield to browser event loop
        await asyncio.sleep(0)

asyncio.ensure_future(main())
