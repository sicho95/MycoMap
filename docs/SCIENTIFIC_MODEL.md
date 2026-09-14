# MycoMap — base scientifique du modèle

## Principe

MycoMap calcule un **indice de potentiel (0–100)**. Ce nombre n'est **jamais** un pourcentage de chance de récolte. La présence d'un sporophore dépend de facteurs non observables par la carte (mycélium réellement présent, âge/état de l'hôte, compétition microbienne, microclimat à quelques mètres, perturbations, pression de cueillette, etc.).

Le moteur sépare volontairement :

1. **Habitat statique** : formation forestière/hôte, sol, relief.
2. **Phénologie + météo** : fenêtre saisonnière et signaux hydriques/thermiques propres au groupe recherché.
3. **Terrain réel privé** : observations positives/négatives enregistrées par l'utilisateur.

Une variable issue d'une étude locale est utilisée comme **poids souple**, jamais comme seuil universel. Une étude de culture in vitro n'est pas transformée en règle de fructification sur le terrain.

Les catégories de l'application sont volontairement larges :

- **Cèpes** = complexe *Boletus edulis* sensu lato (incluant des écologies et phénologies différentes, par ex. *B. edulis*, *B. reticulatus/aestivalis*, *B. aereus*, *B. pinophilus*).
- **Girolles** = *Cantharellus cibarius* sensu lato.
- **Morilles** = *Morchella* spp. tempérées ; le modèle ne prétend pas couvrir parfaitement les morilles de brûlis ou toutes les espèces cultivées.

## Cèpes

### Facteurs retenus

- **Hôte ectomycorhizien obligatoire** : priorité aux peuplements où l'IGN permet d'identifier hêtre, chêne, châtaignier, pin, épicéa/sapin ou bouleau. Une simple classe « feuillus » reste seulement plausible et ne peut, à elle seule, produire un point chaud.
- **Eau disponible / humidité du sol** : poids fort. Les séries longues en forêts de pins espagnoles montrent une relation importante entre production de *B. edulis*, humidité/conditions hydriques et précipitations de la saison de fructification.
- **Température** : utilisée comme modulateur large, pas comme seuil universel. Des études espagnoles trouvent des relations variables selon sites et périodes ; le modèle évite donc un optimum rigide.
- **Signal 20 jours / 26 jours** : le suivi quotidien 2015–2024 en hêtraie d'Europe centrale trouve un pic autour de 13 °C sur 20 jours et une réponse positive aux pluies cumulées sur 26 jours. Cette étude est une **prépublication** à ce jour : MycoMap l'utilise seulement comme raffinement temporel secondaire, pas comme fondement principal.
- **Sol** : préférence souple pour des sols plutôt acides et souvent sableux à sablo-limoneux, sans en faire une exclusion absolue.

### Références principales

- García-Bustamante et al. (2021), *International Journal of Climatology*, « Impact of local and regional climate variability on fungi production from Pinus sylvestris forests in Soria, Spain », DOI: 10.1002/joc.7144.
- de la Varga et al. (2017), *Forest Ecology and Management*, « Effects of forest management and climatic variables on the mycelium dynamics and sporocarp production of the ectomycorrhizal fungus Boletus edulis ».
- Martínez de Aragón / Bonet et al. (2020), « Primary productivity and climate control mushroom yields in Mediterranean pine forests » : séries de 22–24 ans, humidité du sol et précipitations fortement informatives.
- Martínez-Peña et al. (2012/2013), « Yield models for ectomycorrhizal mushrooms in Pinus sylvestris forests with special focus on Boletus edulis » : pluie, température et structure du peuplement significatives.
- Dentinger et al. (2010), étude phylogénétique du groupe *Boletus* en Europe : large gamme d'hôtes de *B. edulis* (Betula, Fagus, Picea, Pinus, Quercus, etc.).
- « Predicting porcini: a decade of sporocarp monitoring… » (bioRxiv, prépublication 2026) : signal 20 j / 26 j. **Niveau de preuve inférieur à une publication peer-reviewed tant que non publiée.**

## Girolles

### Facteurs retenus

- **Ectomycorhize + hôte forestier** : feuillus et conifères compatibles ; hêtre/chêne, pin/épicéa/sapin, bouleau sont valorisés sans devenir des preuves de présence.
- **Sol acide, pauvre et drainant** : la littérature sur *C. cibarius* décrit fréquemment des sols sableux, pauvres en azote et plutôt acides (environ pH 4–5,5 selon les sites). Le pH est un indicateur, pas une barrière stricte.
- **Accumulation thermique et eau plusieurs semaines avant** : une étude canadienne trouve la meilleure relation avec les rendements en combinant degrés-jours base 5 °C, température du sol et eau/précipitations, avec un signal 6–13 semaines avant l'apparition ; environ 500 ± 70 degrés-jours et 50–100 mm cumulés étaient informatifs dans ces peuplements de pin gris.
- **Signal proche de la fructification** : une autre étude de terrain trouve des corrélations positives avec la pluie de la semaine précédente et la température de l'air environ deux semaines avant.
- **Humidité du sol** reste un facteur actif dans le score actuel.

### Références principales

- « Characterization of chanterelle (Cantharellus cibarius) and pine mushrooms… in northern Saskatchewan », *Canadian Journal of Plant Science* 101(6), DOI: 10.1139/cjps-2021-0136.
- « Ecology and productivity of Cantharellus cibarius var. roseocanus in two eastern Canadian jack pine stands », *Botany* 89(10), DOI: 10.1139/b11-058.
- Kumar et al. (2025), revue *Food Science & Nutrition*, DOI: 10.1002/fsn3.4641 : synthèse des préférences de sol, pH, drainage, humidité, température et diversité des hôtes de *Cantharellus cibarius*.

## Morilles

### Facteurs retenus

- **Phénologie printanière forte** : contrairement aux deux groupes précédents, la fenêtre de saison est beaucoup plus contraignante.
- **Réchauffement printanier du sol** : la dynamique de température air/sol est fortement liée au démarrage de fructification.
- **Pluie des 30 jours précédents** : le suivi sur cinq ans de *M. esculenta* montre une abondance positivement associée aux événements de pluie >10 mm durant les 30 jours précédant la fructification.
- **Sol** : plusieurs études de terrain décrivent fréquemment des textures sablo-limoneuses à limoneuses et des pH légèrement acides à neutres ; MycoMap applique donc ces facteurs avec des plages larges.
- **Végétation/hôtes** : orme, tilleul et certains autres arbres apparaissent associés dans des études de terrain, mais l'écologie du genre *Morchella* est très hétérogène. L'arbre est donc seulement un indice modéré.
- **Perturbation / incendie** : facteur important pour certaines morilles, mais pas encore correctement cartographié dans MycoMap. Le modèle reste volontairement conservateur plutôt que d'inventer cette donnée.

### Références principales

- Mihail et al. (2007), *Mycological Research* 111(3), « Spatial and temporal patterns of morel fruiting », DOI: 10.1016/j.mycres.2007.01.007. Suivi de cinq ans : pluie >10 mm/30 j, températures printanières air/sol, réchauffement du sol et associations de végétation.
- « Ecological characterization of Morel (Morchella spp.) habitats: A multivariate comparison from three forest types of district Swat, Pakistan » (2020) : sols sablo-limoneux à limoneux, pH moyen ~6,4, forte influence du contexte forestier. Utilisé comme préférence souple, pas comme seuil universel.

## Ce que le modèle refuse de faire

- Convertir l'indice 0–100 en « 80 % de chance de trouver ».
- Donner 80–90/100 à une forêt générique uniquement parce que la météo est bonne.
- Considérer une pluie récente comme suffisante sans habitat compatible et sans fenêtre phénologique.
- Déclasser fortement un coin après une sortie négative effectuée au mauvais moment météo/saisonnier.
- Généraliser une valeur mesurée dans une seule forêt à toute la France comme règle absolue.

## Données cartographiques utilisées

- IGN BD Forêt v2 : formation forestière / essence quand disponible.
- IGN RGE ALTI : altitude, pente, exposition.
- SoilGrids 2.0 / ISRIC : pH, texture et propriétés hydriques à résolution ~250 m ; ce sont des prédictions spatiales et non des analyses de sol sur place.
- Open-Meteo : séries de pluie, températures et humidité/température du sol utilisées pour les fenêtres temporelles.

La calibration doit ensuite être améliorée par les observations réelles de l'utilisateur, mais celles-ci restent séparées du noyau scientifique afin de distinguer clairement **connaissance générale** et **apprentissage local**.
